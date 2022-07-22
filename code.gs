// 参考: https://best-cloud.jp/slack-message-log-auto-save-gas/
function Run() {
  SetProperties();

  const API_USER_TOKEN = PropertiesService.getScriptProperties().getProperty('slack_api_user_token');
  const API_BOT_TOKEN = PropertiesService.getScriptProperties().getProperty('slack_api_bot_token');
  if (!API_USER_TOKEN || !API_BOT_TOKEN) {
    throw 'You should set "slack_api_token" property from [File] > [Project properties] > [Script properties]';
  }

  let slack = new SlackAccessor(API_USER_TOKEN);
  let slack_bot = new SlackAccessor(API_BOT_TOKEN);

  // メンバーリスト取得
  const memberList = slack.requestMemberList();
  // チャンネル情報取得
  const channelInfo = slack.requestChannelInfo();

  // チャンネルごとにメッセージ内容を取得
  // let first_exec_in_this_channel = false;
  for (let ch of channelInfo) {
    // let timestamp = ssCtrl.getLastTimestamp(ch, 0);
    let n = 60;
    let m = 3;
    let threshold = 20;
    let th_threshold = 1.0 * threshold;
    let now = new Date();
    let timestamp = now.getTime() - n * 60 * 1000;
    // let six_hours_ago = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6時間前

    if ((/.*(zz).*/.test(ch.name)) || isExcludeChannel(ch.name) || isNotifiedChannel(ch.name)) {
      console.log("EXCLUDE: " + ch.name);
      continue;
    } else if (/.*(99).*/.test(ch.name)) {
      console.log("personal channel: " + ch.name);
      m = 5;
      threshold *= 2;
      th_threshold *= 2;
    } else {
      console.log(ch.name)
    }

    let messages = slack.requestMessages(ch, timestamp / 1000.0);
    // if(messages.length > 8) {
    console.log("channel: " + ch.name +  ", len: " + messages.length);
    let value = calcEvaluatin(messages, m);
    if (value >= threshold) {
      slack_bot.postMessage("<#" + ch.id + "|" + ch.name + ">が盛り上がってるよ！")
      writeSpreadSheet(now, ch.name);
      continue;
    }

    
    for (let elem of messages){
      if (elem.thread_ts !== undefined) {
        // if thread root
        let th_messages = slack.requestThreadMessages(ch, elem.thread_ts, elem.thread_ts);
        let th_value = calcEvaluatin(th_messages, m);
        if (th_value >= th_threshold) {
          let th_ts = parseInt(elem.thread_ts * 1000000); 
          const DOMAIN = PropertiesService.getScriptProperties().getProperty('domain');
          slack_bot.postMessage("<#" + ch.id + "|" + ch.name + ">のスレッドが盛り上がってるよ！\nhttps://" + DOMAIN + "/archives/" + ch.id + "/p" + th_ts);
          writeSpreadSheet(now, ch.name);
          break; // threadの通知は1つまで
        }
      }
    }
    // }
  };
  sortSpreadSheet();
  deleteOldData();
}

function calcEvaluatin(message_arr, m){
  // m: threshold number of people joined to conversation
  let user_arr = {};
  for (let elem of message_arr){
    user_arr[elem.user] = ((elem.user in user_arr) ? user_arr[elem.user] + 1 : 1);
  }
  
  if (Object.keys(user_arr).length >= m) {
    let sorted = Object.keys(user_arr).map(function(key) {
      return user_arr[key];
    // sort
    }).sort(function(a, b) {
      return (a < b) ? 1 : -1;  //オブジェクトの降順ソート
    });
    let value = 0;
    for (let i = 0; i < sorted.length; i++) {
      value += sorted[i] * i;
    }
    console.log("val: "+ value);
    return value;
  } else {
    return 0;
  }
}

// Slack へのアクセサ
var SlackAccessor = (function () {
        function SlackAccessor(apiToken) {
        this.APIToken = apiToken;
        }

        var MAX_HISTORY_PAGINATION = 10;
        var HISTORY_COUNT_PER_PAGE = 1000;

        var p = SlackAccessor.prototype;

        // API リクエスト
        p.requestAPI = function (path, params) {
        if (params === void 0) { params = {}; }
        var url = "https://slack.com/api/" + path + "?";
        // var qparams = [("token=" + encodeURIComponent(this.APIToken))];
        var qparams = [];
        for (var k in params) {
        qparams.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
        }
        url += qparams.join('&');
        var headers = {
            'Authorization': 'Bearer ' + this.APIToken
        };
        console.log("==> GET " + url);

        var options = {
            'headers': headers, // 上で作成されたアクセストークンを含むヘッダ情報が入ります
        };
        var response = UrlFetchApp.fetch(url, options);
        var data = JSON.parse(response.getContentText());
        if (data.error) {
            console.log(data);
            console.log(params);
            throw "GET " + path + ": " + data.error;
        }
        return data;
        };

        // メンバーリスト取得
        p.requestMemberList = function () {
            var response = this.requestAPI('users.list');
            var memberNames = {};
            response.members.forEach(function (member) {
                    memberNames[member.id] = member.name;
                    console.log("memberNames[" + member.id + "] = " + member.name);
                    });
            return memberNames;
        };

        // チャンネル情報取得
        p.requestChannelInfo = function () {
            var options = {};
            options['exclude_archived'] = 'true';
            options['limit'] = 500;
            var response = this.requestAPI('conversations.list', options);
            response.channels.forEach(function (channel) {
                    console.log("channel(id:" + channel.id + ") = " + channel.name);
                    });
            return response.channels;
        };

        // 特定チャンネルのメッセージ取得
        p.requestMessages = function (channel, oldest) {
            var _this = this;
            if (oldest === void 0) { oldest = '1'; }

            var messages = [];
            var options = {};
            options['oldest'] = oldest;
            options['count'] = HISTORY_COUNT_PER_PAGE;
            options['channel'] = channel.id;

            var loadChannelHistory = function (oldest) {
                if (oldest) {
                    options['oldest'] = oldest;
                }
                var response = _this.requestAPI('conversations.history', options);
                messages = response.messages.concat(messages);
                return response;
            };

            var resp = loadChannelHistory();
            var page = 1;
            while (resp.has_more && page <= MAX_HISTORY_PAGINATION) {
                resp = loadChannelHistory(resp.messages[0].ts);
                page++;
            }
            console.log("channel(id:" + channel.id + ") = " + channel.name + " => loaded messages.");
            // 最新レコードを一番下にする
            return messages.reverse();
        };

        // 特定チャンネルの特定のスレッドのメッセージ取得
        p.requestThreadMessages = function (channel, ts, oldest) {
            var all_messages = [];
            let _this = this;

            var loadThreadHistory = function (options, oldest) {
                if (oldest) {
                    options['oldest'] = oldest;
                }
                Utilities.sleep(1250);
                var response = _this.requestAPI('conversations.replies', options);

                return response;
            };
            // ts_array = ts_array.reverse();

           
            if (oldest === void 0) { oldest = '1'; }

            let options = {};
            options['oldest'] = oldest;
            options['ts'] = ts;
            options['count'] = HISTORY_COUNT_PER_PAGE;
            options['channel'] = channel.id;

            let messages = [];
            let resp;
            resp = loadThreadHistory(options);
            messages = resp.messages.concat(messages);
            var page = 1;
            while (resp.has_more && page <= MAX_HISTORY_PAGINATION) {
            resp = loadThreadHistory(options, resp.messages[0].ts);
            messages = resp.messages.concat(messages);
            page++;
            }
            // 最初の投稿はスレッド元なので削除
            messages.shift();
            // 最新レコードを一番下にする
            all_messages = all_messages.concat(messages);
            console.log("channel(id:" + channel.id + ") = " + channel.name + " ts = " + ts + " => loaded replies.");
    
            return all_messages;
        };

        // 特定のchannelにメッセージを送信
        p.postMessage = function (msg) {
            const CHANNEL = PropertiesService.getScriptProperties().getProperty('send_channel_id');
            var options = {};
            options['channel'] = CHANNEL;
            options['icon_emoji'] = ":atsumori:"
            options['username'] = "盛り上がりbot";
            options['unfurl_links'] = "true";
            options['unfurl_media'] = "true";
            options['text'] = msg;
            var response = this.requestAPI('chat.postMessage', options);

        };

        return SlackAccessor;
})();

function isExcludeChannel(name){
  const SHEET_ID = PropertiesService.getScriptProperties().getProperty('exclude_sheet_id');
  const ss = SpreadsheetApp.openById(SHEET_ID)
  const sheet = ss.getSheets()[0];
  
  let vals = sheet.getRange("A1:A").getValues();
  let last = vals.filter(String).length;
  const exclude_list = vals.slice(0, last).flat();
  if (exclude_list.includes(name)) {
    // console.log("EXCLUUUUUUUUUDE");
    return true;
  }
  return false;
}

function isNotifiedChannel(name){
    let now = new Date();
    let six_hours_ago = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6時間前
    const SHEET_ID = PropertiesService.getScriptProperties().getProperty('history_sheet_id');
    let sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    let dates = sheet.getRange("A1:A").getValues();
    let last = dates.filter(String).length;
    let names = sheet.getRange("B1:B").getValues();
    const date_list = dates.slice(0, last).flat();
    const name_list = names.slice(0, last).flat();
    let index = name_list.indexOf(name);
    if(index > -1){
      let last_notified = new Date(date_list[index]);
      if (last_notified.getTime() > six_hours_ago.getTime()) {
        return true;
      }
    }
    return false;
}

function writeSpreadSheet(date, name){
  const SHEET_ID = PropertiesService.getScriptProperties().getProperty('history_sheet_id');
  let sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.appendRow([date, name]);
  console.log(date, name);
}

function sortSpreadSheet(){
  const SHEET_ID = PropertiesService.getScriptProperties().getProperty('history_sheet_id');
  let sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.sort(1, false); // A列 (タイムスタンプ) を降順でsort
}

function deleteOldData(){
    let now = new Date();
    let six_hours_ago = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6時間前
    const SHEET_ID = PropertiesService.getScriptProperties().getProperty('history_sheet_id');
    let sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    let dates = sheet.getRange("A1:A").getValues();
    let last = dates.filter(String).length;
    if (last == 0) {return;}
    const date_list = dates.slice(0, last).flat();
    let last_notified = new Date(date_list[last-1]);
    if (last_notified.getTime() > six_hours_ago.getTime() ) {
      return; // 新しかったら消さない
    }else{
      let range = "A" + (last) + ":B100"
      sheet.getRange(range).clearContent(); // last行目以降削除 (書き込み, sortが遅くならないように)
    }
}
