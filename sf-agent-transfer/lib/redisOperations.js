var Promise = require('bluebird');
var config = require('../config.json');
var redis = require('./RedisClient.js').createClient(config.redis);

function updateRedisWithEntry(visitorId, data) {
  return new Promise(function (resolve, reject) {
    redis.hmset('entry:' + visitorId, 'time', new Date(), 'data', JSON.stringify(data), function (err, reply) {
      resolve(reply);
    });
  });
}
function updateRedisWithUserData(visitorId, data) {
  return new Promise(function (resolve, reject) {
    redis.hmset('data:' + visitorId, 'time', new Date(), 'data', JSON.stringify(data), function (err, reply) {
      if (err)
        reject(err);
      resolve(reply);
    });
  });
}
function updateRedisConnectedAgent(userId, data) {
  return new Promise(function (resolve, reject) {
    redis.hmset('connected:' + userId, 'time', new Date(), 'data', JSON.stringify(data), function (err, reply) {
      resolve(reply);
    });
  });
}
function closeConnection() {
  redis.quit();
  console.log("| closeConnection | redisOpeations.js")
}


function setTtl(visitorOrGroupId, hashType) {
  redis.expire(hashType + ':' + visitorOrGroupId, config.redis.ttl);
}

function getRedisData(key) {
  return new Promise(
    function (resolve, reject) {
      redis.hgetall(key, function (err, object) {
        if (err)
          reject(err);
        else
          if (object) {
            var resp;
            try {
              resp = JSON.parse(object.data);
            } catch (e) {
              resp = object.data;
            }
            resolve(resp);
          } else
            resolve(undefined);
      });
    });
}
function get(key) {
  return new Promise(
    function (resolve, reject) {
      redis.get(key, function (object,err) {
        resolve(err)
      })
    })
}

function getRedisKeys(key) {
  return new Promise(
    function (resolve, reject) {
      redis.keys('entry*', function (err, keys) {
        if (err)
          reject(err);
        else
          if (keys) {
            resolve(keys);
          } else
            resolve(undefined);
      });
    });
}
function getRedisTTL(key) {
  return new Promise(
    function (resolve, reject) {
      redis.ttl(key, function (err, object) {
        if (err)
          reject(err);
        else
          if (object) {
            resolve(object);
          } else
            resolve(undefined);
      });
    });
}

function updateRedisById(key) {
  return new Promise(function (resolve, reject) {
    redis.expire(key, config.redis.ttl, function (err, data) {
      resolve(data);
    });
  });
}
function deleteRedisData(key) {
  redis.del(key, function (err, reply) {
  });
}
module.exports.updateRedisWithEntry = updateRedisWithEntry;
module.exports.updateRedisWithUserData = updateRedisWithUserData;
module.exports.updateRedisConnectedAgent = updateRedisConnectedAgent;
module.exports.getRedisData = getRedisData;
module.exports.deleteRedisData = deleteRedisData;
module.exports.setTtl = setTtl;
module.exports.getRedisTTL = getRedisTTL;
module.exports.updateRedisById = updateRedisById;
module.exports.getRedisKeys = getRedisKeys;
module.exports.get = get;
module.exports.closeConnection = closeConnection;
