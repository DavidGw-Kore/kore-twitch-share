var sdk = require('./lib/sdk');
var config = require('./config.json');
var api = require('./salesforceLiveChatAPI.js');
var _ = require('lodash');
var sub = require('./lib/RedisClient.js').createClient(config.redis);
var pub = require('./lib/RedisClient.js').createClient(config.redis);

var redisOperations = require('./lib/redisOperations');

pub.config('SET', 'notify-keyspace-events', 'KExA');
var messageConf = require('./messages.json');

sub.on('message', function(channel, msg) {
  if (msg == 'expired') {
    console.log("VisitorTimeOutEvent.js | sub.on('message') |" + channel + "| message : |", msg);
    var id = channel.split(':')[1];
    pub.get(id + ':data', function(err, reply) {
      var tempData = JSON.parse(reply);
      var data = tempData;

      data.toJSON = function() {
        return {
          __payloadClass: 'OnMessagePayload',
          requestId: data.requestId,
          botId: data.botId,
          componentId: data.componentId,
          sendUserMessageUrl: data.sendUserMessageUrl,
          sendBotMessageUrl: data.sendBotMessageUrl,
          context: data.context,
          channel: data.channel,
          message: messageConf.onExpireMessage,
          overrideMessagePayload: {
            body: messageConf.onExpireMessage,
            isTemplate: false,
          },
        };
      };
      return api.endChat(data.context.session_key, data.context.affinity_token, data, isFromRedis = true).then(function(re) {
        return closeChat(data);
      });

    });

  }
});
function closeChat(data) {
  deleteEvent(data);
  var visitorId = _.get(data, 'channel.channelInfos.from');
  if (!visitorId) {
      visitorId = _.get(data, 'channel.from');
  }
  console.log(visitorId);
  redisOperations.deleteRedisData("entry:" + visitorId)
  redisOperations.deleteRedisData("data:" + visitorId)
  redisOperations.deleteRedisData("connected:" + visitorId)
  sdk.sendUserMessage(data).then(() => {
      sdk.clearAgentSession(data).then(() => {
          console.log("| closeChat | BotKit.js | ClearAgentSession |", visitorId);
      });
  })

}
function addEvent(data, time) {
  var type = data.channel.type || data.channel.channelInfos.type;
  var from = data.channel.from || data.channel.channelInfos.from;
  var uuid = type + '/' + from;
  console.log("|VisitorTimeOutEvent.js | addEvent |"+uuid);
  time = config.redis.ttl;// parseInt(time) || 300;
  pub.set(uuid, JSON.stringify(data));
  pub.set(uuid + ':data', JSON.stringify(data));
  pub.expire(uuid, time);
  sub.subscribe('__keyspace@0__:' + uuid);
}

function deleteEvent(data) {
  var type = data.channel.type || data.channel.channelInfos.type;
  var from = data.channel.from || data.channel.channelInfos.from;
  var uuid = type + '/' + from;
  console.log("|deleteEvent | VisitorTimeOutEvent.js |" + uuid );
  pub.del(uuid);
}
module.exports = {
  add: addEvent,
  delete: deleteEvent,
};
