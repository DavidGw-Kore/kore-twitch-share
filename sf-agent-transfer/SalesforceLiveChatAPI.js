const log4js = require("log4js");
const logger = log4js.getLogger();
const Promise = require('bluebird');
const request = require('request-promise');
const template = require('url-template');
const NodeCache = require("node-cache");
const scheduler = require('node-schedule');

const cache = new NodeCache();

const sfdc_config_file = require("./config.json").sfdc_config_file;
const config = require(sfdc_config_file);

//live agent 
const LIVE_AGENT_URL = config.live_agent.liveAgentUrl;
const ORGANIZATION_ID = config.live_agent.organizationId;
const DEPLOYMENT_ID = config.live_agent.deploymentId;
const API_VERSION = config.live_agent.apiVersion;
const SCREEN_RESOLUTION = config.live_agent.screenResolution;
const USER_AGENT = config.live_agent.userAgent;
const LANGUAGE = config.live_agent.language;

//Oauth
const CLIENT_ID = config.oauth.client_id;
const CLIENT_SECRET = config.oauth.client_secret;
const USERNAME = config.oauth.username;
const PASSWORD = config.oauth.password;
const REDIRECT_URI = config.oauth.redirect_uri
const TOKEN_URI = config.oauth.token_uri;
const API_URI = config.api_url;
const _ = require('lodash');

// Schedules regular update of access token
scheduler.scheduleJob('*/59 * * * *', function () {
    logger.debug("Requesting new access token");
    requestAccessToken();
});


/**
 * Calls the Salesforce live agent API to get the session
 *
 * @returns {bluebird<Promise|any>}
 */
async function getSession() {
    const url = LIVE_AGENT_URL + "/System/SessionId";
    const options = {
        method: 'GET',
        uri: url,
        headers: {
            'X-Liveagent-Affinity': 'null',
            'X-Liveagent-Api-Version': 47
        }
    };
    try {
        const response = await request(options);
        const results = JSON.parse(response);
        logger.debug(`Fetch the session with values key: ${results.key}, id: ${results.id}, clientPollTimeout: ${results.clientPollTimeout}, affinity: ${results.affinityToken}`);
        return JSON.parse(response);
    } catch (error) {
        logger.error(`getSession | salesforceLiveChatAPI.js |${error}`);
        return Promise.reject(error);
    }
}

async function serverFailureNotification() {
    logger.trace("|serverFailtureNotification | salesforceLiveChatAPI.js | started");
    let url = config.instance.notificationUrl;
    let options = {
      method: 'GET',
      uri: url,
      headers: {
      }
    };
    try {
      const response = await request(options);
      logger.debug(`|serverFailtureNotification | salesforceLiveChatAPI.js | ended | ${JSON.stringify(response)}`);
    }
    catch (error) {
      logger.error("serverFailtureNotification | salesforceLiveChatAPI.js | ", error);
      return Promise.reject(err);
    }
  }

/**
 * Helper function the creates the pre-chat details to be sent to initial a chat session between
 * the visitor and the agent.
 *
 * @param lastName
 * @param firstName
 * @param email
 * @param contactId
 * @param caseNumber
 * @returns {({displayToAgent: boolean, transcriptFields: [string], label: string, value, entityMaps: [{fieldName: string, entityName: string}]}|{displayToAgent: boolean, transcriptFields: [string], label: string, value, entityMaps: [{fieldName: string, entityName: string}]}|{displayToAgent: boolean, transcriptFields: [string], label: string, value, entityMaps: [{fieldName: string, entityName: string}]}|{displayToAgent: boolean, transcriptFields: [string], label: string, value, entityMaps: [{fieldName: string, entityName: string}]}|{displayToAgent: boolean, transcriptFields: [string], label: string, value, entityMaps: [{fieldName: string, entityName: string}]})[]}
 */
function getPreChatDetails(lastName, firstName, email, contactId, caseNumber) {
    return [
        {
            "label": "LastName",
            "value": lastName,
            "entityMaps": [
                {
                    "entityName": "Contact",
                    "fieldName": "LastName"
                }
            ],
            "transcriptFields": [
                "LastName__c"
            ],
            "displayToAgent": true
        },
        {
            "label": "FirstName",
            "value": firstName,
            "entityMaps": [
                {
                    "entityName": "Contact",
                    "fieldName": "FirstName"
                }
            ],
            "transcriptFields": [
                "FirstName__c"
            ],
            "displayToAgent": true
        },
        {
            "label": "Email",
            "value": email,
            "entityMaps": [
                {
                    "entityName": "Contact",
                    "fieldName": "Email"
                }
            ],
            "transcriptFields": [
                "Email__c"
            ],
            "displayToAgent": true
        },
        {
            "label": "Id",
            "value": contactId,
            "entityMaps": [
                {
                    "entityName": "Contact",
                    "fieldName": "Id"
                }
            ],
            "transcriptFields": [
                "Id__c"
            ],
            "displayToAgent": true
        },
        {
            "label": "CaseNumber",
            "value": caseNumber,
            "entityMaps": [
                {
                    "entityName": "Case",
                    "fieldName": "CaseNumber"
                }
            ],
            "transcriptFields": [
                "caseNumber__c"
            ],
            "displayToAgent": true
        },
        {
            "label": "Status",
            "value": "New",
            "entityMaps": [
                {
                    "entityName": "Case",
                    "fieldName": "Status"
                }
            ],
            "transcriptFields": [
                "caseStatus__c"
            ],
            "displayToAgent": true
        },
        {
            "label": "Origin",
            "value": "Chat",
            "entityMaps": [
                {
                    "entityName": "Case",
                    "fieldName": "Origin"
                }
            ],
            "transcriptFields": [
                "caseOrigin__c"
            ],
            "displayToAgent": true
        },
        {
            "label": "Subject",
            "value": "TestCaseSubject",
            "entityMaps": [
                {
                    "entityName": "Case",
                    "fieldName": "Subject"
                }
            ],
            "transcriptFields": [
                "subject__c"
            ],
            "displayToAgent": true
        },
        {
            "label": "Description",
            "value": "TestCaseDescriptionShr",
            "entityMaps": [
                {
                    "entityName": "Case",
                    "fieldName": "Description"
                }
            ],
            "transcriptFields": [
                "description__c"
            ],
            "displayToAgent": true
        }
    ];
}

/**
 * Helper function that returns the pre chat entities sent to Salesforce to establish live chat
 * between visitor and agent.
 *
 * @returns Array of pre chat entities
 */
function getPreChatEntities() {
    return [
        {
            "entityName": "Contact",
            "saveToTranscript": "Contact",
            "linkToEntityName": "Case",
            "linkToEntityField": "ContactId",
            "entityFieldsMaps": [

                {
                    "fieldName": "LastName",
                    "label": "LastName",
                    "doFind": true,
                    "isExactMatch": true,
                    "doCreate": true
                },
                {
                    "fieldName": "FirstName",
                    "label": "FirstName",
                    "doFind": true,
                    "isExactMatch": true,
                    "doCreate": true
                },
                {
                    "fieldName": "Email",
                    "label": "Email",
                    "doFind": true,
                    "isExactMatch": true,
                    "doCreate": true
                },
                {
                    "fieldName": "Id",
                    "label": "Id",
                    "doFind": true,
                    "isExactMatch": true,
                    "doCreate": true
                }
            ]
        },
        {
            "entityName": "Case",
            "showOnCreate": true,
            "saveToTranscript": "Case",
            "entityFieldsMaps": [
                {
                    "fieldName": "CaseNumber",
                    "label": "CaseNumber",
                    "doFind": true,
                    "isExactMatch": true,
                    "doCreate": true
                },
                {
                    "fieldName": "Status",
                    "label": "Status",
                    "doFind": false,
                    "isExactMatch": false,
                    "doCreate": true
                },
                {
                    "fieldName": "Origin",
                    "label": "Origin",
                    "doFind": true,
                    "isExactMatch": false,
                    "doCreate": true
                },
                {
                    "fieldName": "Subject",
                    "label": "Subject",
                    "doFind": false,
                    "isExactMatch": false,
                    "doCreate": true
                },
                {
                    "fieldName": "Description",
                    "label": "Description",
                    "doFind": false,
                    "isExactMatch": false,
                    "doCreate": true
                }
            ]
        }
    ];
}

/**
 * Initialize the Salesforce chat between the visitor and the agent.
 * @param session
 * @param options
 * @param caseID
 * @returns {bluebird<*>}
 */
async function initChat(session, options, caseID) {
    logger.trace("Executing the initChat()");
    const contactId = _.get(options, "contactId", null);
    const email = _.get(options, "emailId", null);
    const firstName = _.get(options, "FirstName", null);
    const lastName = _.get(options, "LastName", null);
    const caseNumber = _.get(options, "caseNumber", null);

    logger.debug(`email: ${email}, firstName: ${firstName}, firstName: ${firstName}, caseNumber: ${caseNumber}`);

    // If the buttonId is specified by the caller but is empty than use the
    // value specified in the Salesforce configuration file
    const buttonId = _.get(options, "buttonId", config.live_agent.buttonId);
    const prechatDetails = getPreChatDetails(lastName, firstName, email, contactId, caseNumber);
    const prechatEntities = getPreChatEntities();

    // Body of the request to initialize a chat with the Live Agent in Salesforce
    const body = {
        "organizationId": ORGANIZATION_ID,
        "deploymentId": DEPLOYMENT_ID,
        "sessionkey": session.id,
        "buttonId": buttonId,
        "screenResolution": SCREEN_RESOLUTION,
        "userAgent": USER_AGENT,
        "language": LANGUAGE,
        "visitorName": firstName,
        "prechatDetails": prechatDetails,
        "prechatEntities": prechatEntities,
        "receiveQueueUpdates": true,
        "isPost": true
    };

    logger.trace(`Initiate chat session body: ${JSON.stringify(body)}`);
    let initiateChatRequest = {
        method: 'POST',
        uri: LIVE_AGENT_URL + "/Chasitor/ChasitorInit",
        body: body,
        json: true,
        headers: {
            'X-Liveagent-Sequence': '1',
            'X-Liveagent-Affinity': session.affinityToken,
            'X-Liveagent-Session-Key': session.key,
            'X-Liveagent-Api-Version': API_VERSION
        }
    };
    logger.trace(`initiateChatRequest: ${JSON.stringify(initiateChatRequest)}`);
    return request(initiateChatRequest).then(function (response) {
        logger.debug("Initializing the chat was successful");
        logger.trace(`response: ${JSON.stringify(response)}`);
        return response;
    }).catch(function (error) {
            logger.error(`Initializing chat failed: ${error}`);
            return Promise.reject(error);
        });
}

/**
 * Sends chat messages to SalesForce from visitor
 *
 * @param session_key
 * @param affinity_token
 * @param data
 * @returns {bluebird<*|Promise>}
 */
async function sendMsg(session_key, affinity_token, data) {
    if (data.text === undefined) data.text = '';
    let url = LIVE_AGENT_URL + "/Chasitor/ChatMessage"
    let options = {
        method: 'POST',
        uri: url,
        body: data,
        json: true,
        headers: {
            'X-LIVEAGENT-API-VERSION': API_VERSION,
            'X-LIVEAGENT-AFFINITY': affinity_token,
            'X-LIVEAGENT-SESSION-KEY': session_key
        }
    };
    logger.trace(`|sendMsg | salesforceLiveChatAPI.js | Before Sending Message | ${JSON.stringify(options)}`);
    try {
        const response = await request(options);
        logger.debug(`sendMsg(), response: ${JSON.stringify(response)}`);
        return response;
    } catch (error) {
        logger.error("sendMsg | salesforceLiveChatAPI.js |", error, "failed");
        return Promise.reject(error);
    }
}

// TODO: Use the definition in the utils.js
function IsJsonString(str) {
  try {
      JSON.parse(str);
  } catch (e) {
      return false;
  }
  return true;
}

/**
 * Calls the API to get the messages sent by the Agent from the chat window.
 *
 * @param session_key
 * @param affinity_token
 * @returns Promise
 */
async function getPendingMessages(session_key, affinity_token) {
    let url = LIVE_AGENT_URL + "/System/Messages"
    let options = {
        method: 'GET',
        uri: url,
        headers: {
            'X-LIVEAGENT-API-VERSION': API_VERSION,
            'X-LIVEAGENT-AFFINITY': affinity_token,
            'X-LIVEAGENT-SESSION-KEY': session_key
        }
    };
    logger.trace("|getPendingMessages | salesforceLiveChatAPI.js | ", JSON.stringify(options));
    try {
        const res = await request(options);
        if (IsJsonString(res)) {
            return Promise.resolve(JSON.parse(res));
        }
        return Promise.resolve({"messages": []});
    } catch (err) {
        logger.error("getPendingMessages | salesforceLiveChatAPI.js | ", err.statusCode);
        return Promise.reject(err);
    }
}

/**
 *
 * @param session_key
 * @param affinity_token
 * @returns {Promise}
 */
async function endChat(session_key, affinity_token) {
    logger.trace(`|endChat | salesforceLiveChatAPI.js | ${session_key}`);
    let url = LIVE_AGENT_URL + "/Chasitor/ChatEnd"
    let options = {
        method: 'POST',
        uri: url,
        body: {reason: "client"},
        json: true,
        headers: {
            'X-LIVEAGENT-API-VERSION': API_VERSION,
            'X-LIVEAGENT-AFFINITY': affinity_token,
            'X-LIVEAGENT-SESSION-KEY': session_key
        }
    };
    logger.debug(`|endChat | salesforceLiveChatAPI.js | ${session_key} | ${url}`);
    try {
        const res = await request(options);
        logger.debug(`|endChat | salesforceLiveChatAPI.js  success: ${JSON.stringify(res)}`);
        Promise.resolve(res);
    } catch (error) {
        logger.error(`endChat | salesforceLiveChatAPI.js | error | ${error}`);
        return Promise.reject(error);
    }
}

const jsforce = require('jsforce');
/**
 * Creates an access via Oauth authentication
 */
function requestAccessToken() {
    let username = config.oauth.username;
    let password = config.oauth.password;
    let conn = new jsforce.Connection({
        oauth2 : {
            loginUrl : TOKEN_URI,
            clientId : CLIENT_ID,
            clientSecret : CLIENT_SECRET,
            redirectUri : REDIRECT_URI
        }
    });

    conn.login(username, password, function(err, userInfo) {
        logger.info("login()");
        if (err) { return console.error(err); }
        // Now you can get the access token and instance URL information.
        // Save them to establish connection next time.
        logger.trace(conn.accessToken);
        logger.trace(conn.instanceUrl);
        // logged in user property
        logger.trace(`authtoken is-> ${conn.accessToken}`);
        cache.set("token", conn.accessToken);
        logger.trace(`Access Token from cache ${cache.get("token")}`);
        return conn.accessToken;
    });
}

/**
 * Requests an access token from the Salesforce instance
 * @returns {*}
 */
function authorization() {
    let options = {
        method: 'POST',
        uri: TOKEN_URI,
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        qs: {
            "grant_type": "password",
            "username": USERNAME,
            "password": PASSWORD,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI
        }
    };
    logger.trace(`Body of request is-->${JSON.stringify(options)}`)
    return request(options).then(function (res) {
        logger.trace(`authtoken is-> ${JSON.stringify(res)}`);
        cache.set("token", res);
        logger.trace(`Access Token from cache ${cache.get("token")}`);
    }).catch(function (err) {
        logger.trace(`error is---> ${JSON.stringify(err)}`);
        return Promise.reject(err);
    });
}

function getChatButtons(MasterLabel, token) {
    let initUrl = API_URI + "/services/data/v29.0/query/?q=SELECT Id, DeveloperName,MasterLabel, IsActive, CreatedDate FROM LiveChatButton WHERE MasterLabel='{MasterLabel}'";

    let url = template.parse(initUrl).expand({MasterLabel: MasterLabel});
    let options = {
        method: 'GET',
        uri: url,
        headers: {
            "Authorization": "Bearer " + token
        }
    };
    return request(options).then(function (res) {
        let data = JSON.parse(res);
        return data.records;
    }).catch(function (err) {
        return Promise.reject(err);
    });
}


function createTranscript(data, access_token) {
    let LiveChatButtonId = data.LiveChatButtonId || config.live_agent.buttonId;
    let body = {
        "LiveChatVisitorId": data.LiveChatVisitorId,
        "LiveChatDeploymentId": DEPLOYMENT_ID,
        "LiveChatButtonId": data.LiveChatButtonId,
        "Body": data.Body,
        "Visitor_Type__c": data.Visitor_Type__c,
        "Visitor_Metro__c": data.Visitor_Metro__c,
        "Visitor_Email__c": data.Visitor_Email__c,
        "RequestTime": data.RequestTime,
        "StartTime": data.StartTime,
        "EndTime": data.EndTime,
        "Proactive__c": data.Proactive__c,
        "Chat_Transferred_from_Kore__c": data.Chat_Transferred_from_Kore__c,
    }
    body.LiveChatDeploymentId = deploymentId;
    logger.trace(`body ++++ ${JSON.stringify(body)}`);
    let url = API_URI + "/services/data/v47.0/sobjects/LiveChatTranscript"
    let options = {
        method: 'POST',
        uri: url,
        body: body,
        json: true,
        headers: {
            authorization: "Bearer " + access_token
        }
    };

    return request(options).then(function (res) {
        return res;
    }).catch(function (err) {
        return Promise.reject(err);
    });
}

function createChatVisitorSession() {
    let url = LIVE_AGENT_URL + "/Visitor/VisitorId"
    let options = {
        method: 'GET',
        uri: url,
        qs: {
            "org_id": ORGANIZATION_ID,
            "deployment_id": DEPLOYMENT_ID
        },
        headers: {
            'X-LIVEAGENT-API-VERSION':  API_VERSION
        }
    };
    return request(options).then(function (res) {
        return JSON.parse(res);
    }).catch(function (err) {
        return Promise.reject(err);
    });
}

function createVisitor(body, access_token) {
    let url = API_URI + "/services/data/v47.0/sobjects/LiveChatVisitor"
    let options = {
        method: 'POST',
        uri: url,
        body: body,
        json: true,
        headers: {
            authorization: "Bearer " + access_token
        }
    };
    return request(options).then(function (res) {
        return res;
    }).catch(function (err) {
        return Promise.reject(err);
    });
}

/**
 * Requests an access token if not cached.
 *
 * @returns access token
 */
function getJWTToken() {
    if (cache.get("token")) {
        logger.trace(cache.get("token"));
        return cache.get("token");
    } else {
        return requestAccessToken();
    }
}

module.exports.getJWTToken = getJWTToken;
module.exports.initChat = initChat;
module.exports.sendMsg = sendMsg;
module.exports.getPendingMessages = getPendingMessages;
module.exports.getSession = getSession;
module.exports.endChat = endChat;
module.exports.authorization = authorization;
module.exports.requestAccesstoken = requestAccessToken;
module.exports.getChatButtons = getChatButtons;
module.exports.createTranscript = createTranscript;
module.exports.createVisitor = createVisitor;
module.exports.createChatVisitorSession = createChatVisitorSession;
module.exports.serverFailureNotification = serverFailureNotification;
