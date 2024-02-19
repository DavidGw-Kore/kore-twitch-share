const log4js = require("log4js");
const logger = log4js.getLogger();

// Utility class to get brand family information
const BrandFamilyInformation = require("./brandFamilyInformation");

const bot = require("./config.json").bot;
const botId = bot.id;
const botName = bot.name;
const sdk = require("./lib/sdk");
const Promise = require("bluebird");
const request = require('request-promise');
const api = require('./SalesforceLiveChatAPI.js');
const _ = require('lodash');
const config = require('./config.json');
const debug = require('debug')("Agent");

// TODO: This should be put in the context since they are related to brand family
// Messages sent back to the user
const messageConf = require('./message.json');
const redisOperations = require('./lib/redisOperations');
const VisitorTimeOutEvent = require("./VisitorTimeOutEvent.js");
const utils = require("./utils");
const sfdcConfig = require(config.sfdc_config_file);
const API_URI = sfdcConfig.api_uri;

const logLevel = config.log_level;
logger.level = logLevel; // default level is OFF - which means no logs at all.
logger.debug("Loading Beverage Buddy Application");

/**
 * Fetches the messages from the Salesforce live agent chats typed by the agent to the visitor
 * @param visitorId
 * @param session_key
 * @param affinity_token
 * @param count
 * @returns {bluebird<void>}
 */
async function getPendingMessages(visitorId, session_key, affinity_token, count) {
    count = count || 1;
    logger.info(`${count}, visitorId: ${visitorId}, session_key: ${session_key}, affinity_token: ${affinity_token}`);
    let endChat = false;
    let agentClosed = false;

    // Look in Redis database with key from visitor Id.
    logger.trace(`Data lookup from visitor ${visitorId}`);
    redisOperations.getRedisData("data:" + visitorId).then(function (data) {

        // We found data in the Redis database so now lets process it
        if (data) {
            logger.trace(`Data found for visitor ${visitorId}: ${JSON.stringify(data)}`);
            return api.getPendingMessages(session_key, affinity_token)
                .then(function (res) {
                    _.each(res.messages, function (event, key) {
                        logger.debug(`key: ${JSON.stringify(key)}, event: ${JSON.stringify(event)}`)
                        // Identify the event and process accordingly
                        if (event.type === "ChatEstablished") {
                            logger.info(`Chat established for visitor: ${visitorId}`);
                            let timeout = event.message.chasitorIdleTimeout.timeout
                            data.context.session_key = session_key;
                            data.context.affinity_token = affinity_token;
                            VisitorTimeOutEvent.add(data, timeout);

                        } else if (event.type === "ChatRequestSuccess") {
                            logger.info(`Successful chat requested for visitor: ${visitorId}`);

                            // Use the timeout value provide in the message to set a timeout value
                            // for the visitor
                            let timeout = event.message.connectionTimeout;
                            data.context.session_key = session_key;
                            data.context.affinity_token = affinity_token;
                            VisitorTimeOutEvent.add(data, timeout);

                        } else if (event.type === "ChatMessage") {
                            // Extract the text sent by the Agent
                            data.message = event.message.text;
                            // Indicate that we are going to override what to send to the visitor
                            data.overrideMessagePayload = null;
                            logger.debug(`Agent to visitor ${visitorId}, message: ${data.message}`);

                            let interval = key >= 1 ? 1000 * (key) : 0;
                            setTimeout(function (tempdata) {
                                return sdk.sendUserMessage(tempdata, function (error) {
                                    if (error) {
                                        logger.error(`An error occurred ${JSON.stringify(error)}`);
                                        return api.endChat(session_key, affinity_token).then(function (re) {
                                            return closeChat(tempdata);
                                        });
                                    }
                                }).catch(function (error) {
                                    logger.error("getPendingMessages | BotKit.js | ChatMessage (FromAgent) | ", error);
                                });
                            }, interval, _.clone(data));

                        } else if (event.type === "ChatEnded") {
                            logger.info(`Chat with visitorId: ${visitorId} has ended`)

                            // We received from Salesforce that the agent terminated the chat
                            endChat = true;

                            // Remove the current visitor from a time out event
                            VisitorTimeOutEvent.delete(data);
                            redisOperations.deleteRedisData(`entry:${visitorId}`);
                            redisOperations.deleteRedisData(`data:${visitorId}`);
                            redisOperations.deleteRedisData(`connected:${visitorId}`)

                            // Clear the agent session to return the Bot conversation
                            sdk.clearAgentSession(data);
                            logger.info(`Chat session cleared for visitor: ${visitorId}`);

                            // TODO: This message should come from the bot context with the proper
                            //       brand family voice
                            // Send chat end message from message.conf configuration
                            data.message = messageConf.chatEndedMsg;
                            data.overrideMessagePayload = null;

                            // Sends a message to the visitor that the chat has ended.
                            logger.info(`Sending chat ended message to visitorId: ${visitorId}`);
                            sdk.sendUserMessage(data, function () {
                                // Invoke the main menu of the bot
                                data.message = messageConf.howToHelpTask;
                                return sdk.sendBotMessage(data);
                            });

                        } else if (event.type === "ChatRequestFail" && event.message.reason !== "NoPost") {
                            // TODO: What are the possible reasons for the the event type to be ChatRequestFail
                            logger.info(`Chat request failed for visitorId: ${visitorId} with reason: ${event.message.reason}`);

                            // Delete visitor's information from the Redis database
                            redisOperations.deleteRedisData("entry:" + visitorId)
                            redisOperations.deleteRedisData("data:" + visitorId)
                            redisOperations.deleteRedisData("connected:" + visitorId)

                            // Set flag that indicates that the chat between the agent and the visitor is terminated
                            endChat = true;

                            // Calls API back on
                            sdk.clearAgentSession(data);
                            data.message = messageConf.chatRequestFailMsg;
                            data.overrideMessagePayload = null;
                            logger.info(`Sending message that no agents are available for visitorId: ${visitorId}`);
                            return sdk.sendUserMessage(data, function () {
                                // Invoke the main menu of the bot
                                data.message = messageConf.howToHelpTask;
                                return sdk.sendBotMessage(data);
                            });
                        }
                    });

                    if (endChat) {
                        logger.trace("-------chatended----------")
                        logger.info(`|getPendingMessages | BotKit.js | PollingStop | Count : ${count} | ${visitorId}`);
                    }

                    if (agentClosed) {
                        logger.info("Agent closed---------")
                        clearAgentNotification(data, visitorId);
                    }
                    // TODO: This does nothing is it suppose to be combined with the line below???
                    if (!endChat)

                        getPendingMessages(visitorId, session_key, affinity_token, count + 1);
                })
                .catch(function (e) {
                    logger.error(`|getPendingMessages | BotKit.js | ERROR From getMessages Api | Error Code | ${e.statusCode}`);
                    if (e.statusCode === 403) {
                        logger.error(`|getPendingMessages | BotKit.js | Removing Expired Session from Redis | ${visitorId}`);
                    }
                    clearAgentNotification(data, visitorId);
                });
        } else {
            logger.debug(`|getPendingMessages | BotKit.js | Data not found | ${visitorId}`);
            logger.debug(`|getPendingMessages | BotKit.js | PollingStop  | ${visitorId}`);
        }
    }).catch(function (error) {
        logger.error(`|getPendingMessages | BotKit.js | ERROR While Retrieving Redis Data | ${error}`);
    });
}

/**
 * Sleeps for the specific amount of time specified by the input variable in milliseconds.
 * Implement using setTimeout() and Promise
 *
 * @param ms
 * @returns {Promise}
 */
function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
}

/**
 * Uses the Bot Kit SDK functions to fetch the message from the channel the bot user.
 * @param limit
 * @param offset
 * @param data
 * @returns {Promise}
 */
function gethistory(limit, offset, data) {
    return new Promise(function (resolve, reject) {
        if (data) {
            data.limit = limit;
            data.offset = offset;
            data.channelType = _.get(data, 'context.session.BotUserSession.lastMessage.channel', "");
            sdk.getMessages(data, function (error, response) {
                logger.trace(`sdk.getMessages() response: ${JSON.stringify(response)}`)
                if (error) {
                    return reject(error);
                }
                return resolve(response.messages);
            });
        } else {
            let error = {
                msg: "gethistory failed for user",
                code: 401
            };
            return reject(error);
        }
    });
}

/**
 *
 * @param data
 * @param offset
 * @returns {*}
 */
function getSessionHistory(data, offset) {
    offset = offset || 0;
    let limit = 5;
    let channel = _.get(data, 'context.session.BotUserSession.lastMessage.channel', "");
    return gethistory(limit, offset, data)
        .then(function (messages) {
            messages = messages || [];
            return messages;
        }).catch(function (e) {
            console.error("getSessionHistory | BotKit.js | ERROR", e);
        });
}


/**
 *
 * @param requestId
 * @param data
 * @param cb
 * @returns {bluebird<void>}
 */
async function onAgentTransfer(requestId, data, cb) {
    logger.trace("Executing onAgentTransfer()");

    // Extract the visitor id from the web channel or other channel
    logger.trace(`${JSON.stringify(data.channel)}`)
    let visitorId = _.get(data, 'channel.channelInfos.from');
    if (!visitorId) {
        visitorId = _.get(data, 'channel.from');
    }

    logger.debug(`Connection visitor with id ${visitorId} to agent`);
    redisOperations.updateRedisWithUserData(visitorId, data).then(function () {
        logger.debug(`Add visitor ${visitorId} to redis database`);
        redisOperations.setTtl("data", visitorId);
    })

    // TODO: There are specific responses sent to the user from configuration file
    //       this should be pulled from the bot context.
    data.message = messageConf.agentAssignMsg;
    data.overrideMessagePayload = null;

    sdk.sendUserMessage(data, cb).then(async function () {
        try {
            const session = await api.getSession();
            logger.trace(`Session returned from Salesforce: ${JSON.stringify(session)}`);
            let options = {};

            // Agent transfer requires that the:
            //     1) The User's first, last, and full name are known.
            //     2) A contact has been created or already existed
            //     3) A case has been created and the case number is available
            //     4) The case record id is available
            //
            options.FirstName = data.context.session.BotUserSession.firstName;
            options.LastName = data.context.session.BotUserSession.lastName;
            options.VisitorName = data.context.session.BotUserSession.name;
            options.emailId = data.context.session.BotUserSession.emailId;
            options.contactId = data.context.session.BotUserSession.contactId;
            options.caseNumber = data.context.session.BotUserSession.caseNum;
            options.caseId = data.context.session.BotUserSession.caseId;

            logger.debug(`FirstName: ${options.FirstName}`);
            logger.debug(`LastName: ${options.LastName}`);
            logger.debug(`VisitorName: ${options.VisitorName}`);
            logger.debug(`emailId: ${options.emailId}`);
            logger.debug(`contactId: ${options.contactId}`);
            logger.debug(`caseNumber: ${options.caseNumber}`);

            logger.info(`Initializing chat with agent for ${visitorId} and ${options.emailId}`);

            await api.initChat(session, options);
            logger.debug(`session_key = "${session.key}", affinity_token: "${session.affinityToken}", visitorId: "${visitorId}"`);

            // Information returned from the initiation of the agent transfer
            // This information is stored in the Redis database for later retrieval for
            // making API calls to exchange the chat message between the Visitor an Agent.
            //
            // The visitor id is used for the key to get state information from the Redis database
            const redisEntry = {
                session_key: session.key,
                affinity_token: session.affinityToken,
                visitorId: visitorId,
            };

            // Updates session_key, affinity_token keyed to the visitorId
            redisOperations.updateRedisWithEntry(visitorId, redisEntry).then(function (res) {
                logger.debug(`Add vistorId: ${visitorId} to the Redis database`);
                redisOperations.setTtl("entry", visitorId);

                // Store the date on when the Visitor connected
                let connectToAgent = {"server": 1, "time": new Date()}
                getPendingMessages(visitorId, session.key, session.affinityToken).then(function (response) {
                    logger.trace(`Response from getPendingMessages(): ${JSON.stringify(response)}`)

                    redisOperations.updateRedisConnectedAgent(visitorId, connectToAgent).then(function () {
                        redisOperations.setTtl("connected", visitorId);
                        VisitorTimeOutEvent.add(data);
                        getSessionHistory(data).then(async function (messages) {
                            let contactId = "";
                            let str;
                            logger.debug(`BotUserSession.caseId: ${data.context.session.BotUserSession.caseId}`);
                            logger.debug(`BotUserSession.contactId: ${data.context.session.BotUserSession.contactId}`);
                            logger.debug(`BotUserSession.name: ${data.context.session.BotUserSession.name}`);
                            if (data.context.session.BotUserSession.caseId) {
                                contactId = data.context.session.BotUserSession.contactId;
                                logger.debug(`contactId: ${contactId}`);
                                str = "Name: " + data.context.session.BotUserSession.name;
                                str = str + "\nCase Id: " + data.context.session.BotUserSession.caseId;
                                str = str + "\nCase Number: " + data.context.session.BotUserSession.caseNum;
                                str = str + "\nContact Id: " + contactId + "\n";
                            }

                            str = str + await utils.getHistoryString(messages);
                            logger.debug(`Message history is ${str}`);
                            let message = {
                                text: str
                            };
                            // NOTE: Salesforce platform issue made us add a delay of 3 seconds.
                            logger.debug("Waiting for Salesforce platform to be ready");
                            await sleep(3000)
                            logger.debug("Ready");
                            api.sendMsg(session.key, session.affinityToken, message).catch(function (error) {
                                logger.debug("connectToAgent | BotKit.js | Error while Sending Transcript |", visitorId, error);
                                redisOperations.deleteRedisData("data:" + visitorId);
                                redisOperations.deleteRedisData("entry:" + visitorId);
                                redisOperations.deleteRedisData("connected:" + visitorId);
                                VisitorTimeOutEvent.delete(data);
                            });
                        });
                    }).catch(function (error) {
                        logger.error(`|onAgentTransfer | BotKit.js | An error occured while processing the pending messages ${error}`);
                    });
                    logger.info(`| onAgentTransfer | BotKit.js | PollingStarted |  ${visitorId}`);
                    // TODO: Why was this commented out
                    //    getPendingMessages(visitorId, session.key, session.affinityToken);
                });
            });
        } catch (error) {
            logger.error(`Error trying to send message: ${JSON.stringify(error)}`);

            // Delete the visitor from the Redis database that is tracking the visitor
            redisOperations.deleteRedisData(`data:${visitorId}`);
            redisOperations.deleteRedisData(`entry:${visitorId}`);
            redisOperations.deleteRedisData(`connected:${visitorId}`);

            // Disable the visitor time out
            VisitorTimeOutEvent.delete(data);

            // Clear the agent session to return the bot conversation
            sdk.clearAgentSession(data);

            // TODO: This needs to come from bot context with voicing for Brand Family
            data.message = messageConf.chatRequestFailMsg;
            data.overrideMessagePayload = null;
            return sdk.sendUserMessage(data, async function () {
            // TODO: There is not an AnythingElseDialog in this bot!!!
            //     //invoking dialog AnythingElseDialog after failing
            //     data.message = "AnythingElseDialog";
            //     await sdk.sendBotMessage(data);
            //     logger.debug(`connectToAgent | BotKit.js | Invoking AnythingElseDialog | ${visitorId}`);
            });
        }
    });
}

/**
 * Creates the payload to close a case in Salesforce
 * @param brandId - Internal code from Salesforce that indicates a specific brand of beverage
 * @param subject1 - Custom field in the Salesforce Case object used to classify the case
 * @param subject2 - Custom field in the Salesforce Case object used to classify the case
 * @param contactId - Id of the Contact object that represents the visitor using the chatbot.
 * @returns {{Status: string, Origin: string, B2C_Brand__c, RecordType: {Name: string}, Priority: string, B2C_Do_Not_Communicate_For_This_Case__c: string, ContactId, B2C_Subject1__c, B2C_Subject2__c}}
 */
function updateCasePayload(brandId, subject1, subject2, contactId) {
    return {
        "Status": "Closed",
        "Origin": "Chat",
        "B2C_Brand__c": brandId,
        "Priority": "Medium",
        "RecordType": {
            "Name": "Inquiry"
        },
        "B2C_Do_Not_Communicate_For_This_Case__c": "true",
        "B2C_Subject1__c": subject1,
        "B2C_Subject2__c": subject2,
        "ContactId": contactId
    }
}

/**
 * Creates the properties need to request that a record in Case object update via the PATCH method.
 * @param payload - Payload to be sent in the body of the request
 * @param caseId - The specific record on the Case object to be updated.
 */
function updateCaseRequestOptions(payload, caseId) {
    return {
        method: 'PATCH',
        body: payload,
        uri: API_URI + '/sobjects/case/' + caseId,
        headers: {
            'content-type': 'application/json',
            "Authorization": "Bearer " + api.getJWTToken()
        },
        json: true
    };
}

/**
 * A request to Salesforce to close a case.
 *
 * @param requestOptions - Contains parameters of the request. see function optionsClosed()
 * @param data - Bot context data
 */
function issueRequest(requestOptions, data) {
    logger.debug(`requestOptions: ${JSON.stringify(requestOptions)}`);
    request(requestOptions).then(function (response) {
        logger.trace(`response: ${JSON.stringify(response)}`);
        // Set variables to undefined since we successfully updated the case
        data.context.session.BotUserSession.case_update = undefined;
        data.context.session.BotUserSession.case_beverage_type = undefined;
        data.context.session.BotUserSession.case_subject_1 = undefined;
        data.context.session.BotUserSession.case_subject_2 = undefined;
    }).catch(function (error) {
        logger.error(JSON.stringify(error))
        // An error occurred set variables to undefined so that case will
        // be attempted to update a second time.
        data.context.session.BotUserSession.case_update = undefined;
        data.context.session.BotUserSession.case_subject_1 = undefined;
        data.context.session.BotUserSession.case_subject_2 = undefined;
        data.context.session.BotUserSession.case_beverage_type = undefined;
    });
}

/**
 *  Handles the closure of cases. Expects the context.BotUserSession.case_close_type to be set to trigger
 *  updating the visitor's case. This context variable is a string
 *
 *  @param data Bot context data
 */
function handleUpdateCase(data) {
    let caseUpdate = data.context.session.BotUserSession.case_update;
    // Check to see if there was a request to update the current visitors case
    if (caseUpdate) {
        // Extract the brand family information from the bot context
        const configuredBrandFamilyInformation = data.context.session.BotUserSession.brand_family_information;

        // Make an instance of the BrandFamilyInformation to access the brand family information
        const brandFamilyInformation = new BrandFamilyInformation(configuredBrandFamilyInformation);

        // Get the beverage type set by the bot to set the brand id in the case
        const beverageType = data.context.session.BotUserSession.case_beverage_type;

        // There are two sets of values one for the stage the other production which is provided
        // on the BotUserSession variable environment
        const isProduction = data.context.session.BotUserSession.ENVIRONMENT === 'production';

        // Lookup the brandId code (configured by salesforce) from the brand family database
        // which represents a single brand
        const brandId = brandFamilyInformation.getSalesforceCodeFromProductCode(beverageType, isProduction);

        // Get the contact and case id associated with this visitor
        const contactId = data.context.session.BotUserSession.contactId;
        const caseId = data.context.session.BotUserSession.caseId;
        logger.debug(`contactId: ${contactId}, caseId: ${caseId}`)

        // These subjects are required to be set by bot when the case close type is set
        const subject1 = data.context.session.BotUserSession.case_subject1;
        const subject2 = data.context.session.BotUserSession.case_subject2;

        // build the payload and initiate the request
        const caseUpdatePayload = updateCasePayload(brandId, subject1, subject2, contactId);
        const caseUpdateRequest = updateCaseRequestOptions(caseUpdatePayload, caseId);
        logger.debug(`caseUpdate: ${caseUpdate}, brandId: ${brandId}, beverage: ${beverageType}, subject1: ${subject1}, subject2: ${subject2}`);
        issueRequest(caseUpdateRequest, data);
    }
}

/**
 * Handles the bot message request.
 *
 * @param requestId - Unique id representing the specific request
 * @param data - Data passed from the bot
 * @param cb - Callback to invoke
 */
function onBotMessage(requestId, data, cb) {
    logger.debug(`Bot Message Data: ${data.message}`);

    // See the Salesforce Token for API calls
    api.getJWTToken();

    // Checks the message to see if we need to update the current case
    handleUpdateCase(data);

    // Return if there is nothing to handle
    if (data.message.length === 0 || data.message === '') {
        return;
    }

    // Extract the visitor id which is based upon the user from the channel configuration
    let visitorId = _.get(data, 'channel.from');

    // Perform a look up the visitor to determine if they are talking with an Aget
    redisOperations.getRedisData("entry:" + visitorId).then(function (entry) {
        logger.debug(`Data fetched from redis for ${visitorId} with value of ${JSON.stringify(entry)}`);
        let message_tone = _.get(data, 'context.message_tone');
        // Provide special handling if the tone of the message sent by the visitor is angry
        if (message_tone && message_tone.length > 0) {
            // TODO: Not sure if this logic needs to be within the bot since this is handled
            //       at the bot level. Leave for now.
            let angry = _.filter(message_tone, {
                tone_name: 'angry'
            });
            if (angry.length) {
                angry = angry[0];
                // Invoke the Agent Transfer
                if ((angry.level === 3 || angry.level > 3) && (data.context && data.context.intent !== "Agent Chat")) {
                    logger.debug(`|connectToAgent | BotKit.js | Angry Level Found |${visitorId}`);
                    data.message = "Agent Chat";
                    data.overrideMessagePayload = null;
                    return sdk.sendBotMessage(data);
                } else {
                    sdk.sendUserMessage(data, cb);
                }
            } else {
                logger.info(`Agent is sending message to Visitor, message: ${data.message}`);
                sdk.sendUserMessage(data, cb);
            }
        } else if (!entry) {
            logger.info(`Bot is sending message to Visitor, message: ${data.message}`);
            sdk.sendUserMessage(data, cb);
        }
    });
}

/**
 * 1) Queries Salesforce Contact Object based on email address provided by "Email" entity.
 * 2) If email is not found in the Contact Object then create a record in the Contact Object
 *
 * @param data Context data from the bot
 * @param cb
 * @returns Promise
 */
// TODO: Better function name
function salesforceAPIInvocation(data, cb){
    logger.debug("function salesforceAPIInvocation");

    // 1) Create local variables of entities used by
    // this function to avoid long statements
    // 2) Documentation on what entities are using within this function
    // 3) Permits easy change should an entity name change within the Bot
    // 4) We set these to constant since they should not change
    const email = data.context.entities.Email;
    const name = data.context.entities.Name;
    const birthday = data.context.entities.Birthday;
    const zip = data.context.entities.Zip;
    const optIn = data.context.entities.optIn;
    const optInPolicy = data.context.entities.OptInPolicy

    // With out and email there is nothing we can do
    if(email) {
        logger.debug(`email: ${email}`);
        // Check to see if the user opted in for being contacted by email
        let optInVal = "false"
        if (optIn && optIn.toLowerCase() === "yes")
        {
            if(optInPolicy && optInPolicy.toLowerCase() === "yes"){
                optInVal="true"
            }
        }

        // Perform a query against Salesforce based upon the user email of the visitor
        let searchContact = {
            method: 'GET',
            uri: API_URI + '/query/?q=SELECT+Id+from+Contact+where+Email='+'\''+email +'\''+'order+by+createddate+desc+LIMIT+1',
            headers: {
                'content-type': 'application/json',
                "Authorization":"Bearer "+ api.getJWTToken()
            }
        };
        logger.debug(`searchContact: ${JSON.stringify(searchContact)}`);
        return request(searchContact).then(function (res) {
            let resp = JSON.parse(res);
            // This should always return a result sets of 1 since the query to Salesforce uses the LIMIT 1 clause
            if(resp.totalSize === 1) {
                // The was a result to our search by email
                // Set a flag that the user has been confirmed
                data.context.confirmed = "true";

                // Extract the id of the record from Salesforce
                // and put into a context variable
                let contactId = JSON.parse(res).records[0].Id;
                data.context.contactId = contactId;

                logger.info(`Found contact record ${contactId} associated with email: ${email}`);

                // Make a call to get the result of the details
                let getContactDetails = {
                    method: 'GET',
                    uri: API_URI+'/sobjects/Contact/'+ contactId,
                    headers: {
                        'content-type': 'application/json',
                        "Authorization":"Bearer "+ api.getJWTToken()
                    }
                };
                return  request(getContactDetails).then(function (response){
                    logger.trace(`Response from existing user contact record: ${response}`);
                    const contact = JSON.parse(response);
                    data.context.firstName = contact.FirstName;
                    data.context.lastName = contact.LastName;
                    data.context.name = contact.Name;
                    data.context.contactId = contact.Id;
                    data.context.emailId = contact.Email;
                    data.context.contactDetails = contact;
                    return data;
                }).catch(function (error) {
                    logger.error(`Error ${JSON.stringify(error)}`);
                });
            } else {
                // User was not found, create a new contact record in Salesforce
                // Check to see if we have all of the information we need to populate the
                // record in Salesforce

                if (email && name && birthday && zip) {
                    logger.debug(birthday)
                    let sdfcDate = "";
                    // Alter the date format from the bot platform to that required by Salesforce
                    if (birthday) {
                        sdfcDate = birthday.replace(/(\d\d)\/(\d\d)\/(\d{4})/, "$3-$1-$2");
                    }
                    let firstName = "";
                    let lastName = "";
                    if (name) {
                        // TODO: If the user provides a name with no spaces both the firstName and the lastName
                        //       will have the same value.
                        let fullName = name.split(' ');
                        firstName = fullName[0];
                        lastName = fullName[fullName.length - 1];
                    }
                    logger.debug(`name: ${name}, firstName: ${firstName}, lastName: ${lastName}, email: ${email}`)
                    let contactBody = {
                        "LastName": lastName,
                        "FirstName": firstName,
                        "Email": email,
                        "MobilePhone": "",
                        "Status__c": "Active",
                        "MailingPostalCode": zip,
                        "B2C_OPT_IN__c": optInVal,
                        "B2C_Contact_Type__c": "Consumer",
                        "Birthdate": sdfcDate,
                        "B2C_Live_Chat_Optin__c": "on",
                        "RecordType": {
                            "Name": "ABI B2C"
                        }
                    }
                    logger.debug(`contactBody: ${JSON.stringify(contactBody)}`);
                    let createContactRequest = {
                        method: 'POST',
                        body: contactBody,
                        uri: API_URI + '/sobjects/Contact/',
                        headers: {
                            'content-type': 'application/json',
                            "Authorization": "Bearer " + api.getJWTToken()
                        },
                        json: true
                    };
                    return request(createContactRequest).then(function (response) {
                        logger.trace(`name: ${name}, firstName: ${firstName}, lastName: ${lastName}, email: ${email}`)
                        data.context.firstName = firstName;
                        data.context.lastName = lastName;
                        data.context.session.BotUserSession.Name = name;
                        data.context.emailId = email
                        logger.trace(`Contact created: ${JSON.stringify(response)}`);
                        logger.info(`Created a new contact with id: ${response.id} for email: ${email}`);
                        // TODO Not sure why there has to be two different context variables
                        //      one for creating the contact and one for creating the contact
                        data.context.contactId = response.id;
                        data.context.confirmed = "true";
                        return data;
                    }).catch(function (error) {
                        logger.error(`Error: ${JSON.stringify(error)}`)
                    });
                }
            }
        }).catch(function (error) {
            logger.error(`Error ${JSON.stringify(error)}`);
        });
    }
}

/**
 * Creates a Case in Salesforce using a contactId either created or looked up.
 *
 * @param data
 * @param callback
 * @returns {*}
 */
function createCase(data, callback) {
    const contactId = data.context.contactId;
    const isProduction = data.context.session.BotUserSession.ENVIRONMENT === 'production';

    const brand_family_information = data.context.session.BotUserSession.brand_family_information;
    const brandFamilyInformation = new BrandFamilyInformation(brand_family_information);
    const website = brandFamilyInformation.getWebsite();
    const brand_default = brandFamilyInformation.getDefaultBrand();
    const brandId = brandFamilyInformation.getSalesforceCodeFromProductCode(brand_default, isProduction);

    logger.debug(`website: ${website}, contactId: ${contactId}`);

    let dataCaseCreation = {
        "Status": "New",
        "Origin": "Chat",
        "Priority": "Medium",
        "RecordType": {
            "Name": "Inquiry"
        },
        "B2C_Brand__c": brandId,
        "B2C_Subject1__c": "Availability",
        "B2C_Subject2__c": "General",
        "Product_Information__c": website,
        "ContactId": contactId
    };

    let options = {
        method: 'POST',
        body: dataCaseCreation,
        uri: API_URI + '/sobjects/case/',
        headers: {
            'content-type': 'application/json',
            "Authorization": "Bearer " + api.getJWTToken()
        },
        json: true
    };

    return request(options).then(function (response) {
        logger.trace(`New case response: ${JSON.stringify(response)}`);
        data.context.caseId = response.id;
        logger.info(`New case with id ${response.id} for contactId: ${contactId}`)
        return data;
    }).catch(function (error) {
        logger.error(JSON.stringify(error))
    });
}

/**
 * Looks up an existing case in Salesforce
 * @param data
 * @param callback
 * @returns {*}
 */
function getCaseNumber(data, callback) {
    let caseId = data.context.caseId;

    // Getting the case number with the newly created case id
    let getCaseNumber = {
        method: 'GET',
        uri: API_URI + '/query/?q=SELECT+CaseNumber+FROM+Case+WHERE+Id=' + '\'' + caseId + '\'',
        headers: {
            'content-type': 'application/json',
            "Authorization": "Bearer " + api.getJWTToken()
        }
    };
    return request(getCaseNumber).then(function (response) {
        logger.trace(`Response from querying for case ${JSON.stringify(response)}`);
        data.context.caseNum = JSON.parse(response).records[0].CaseNumber;
        logger.debug(`data.context.caseNum: ${data.context.caseNum}`);
        return data;
    }).catch(function (error) {
        logger.error(JSON.stringify(error))
    });
}

/**
 * Creates a feedback record in Salesforce using the custom object "Survey_Response__c"
 *
 * @param data - Context data from the bot
 * @param callback
 * @returns {*}
 */
function gatherFeedback(data, callback) {
    const rating = parseInt(data.context.entities.OverallExperienceFeedback);
    const ratingB = parseInt(data.context.entities.GetHelpFeedback);
    const caseId = data.context.session.BotUserSession.caseId;
    const description = data.context.entities.DescriptionFeedback;
    logger.info(`Overall Experience: ${rating}`);
    logger.info(`Help Feedback: ${ratingB}`);
    logger.info(`Description: ${description}`);
    const createFeedbackData = {
        "B2C_Services_Satisfaction__c": rating,
        "B2C_Customer_Effort_Score__c": ratingB,
        "B2C_Verbatim__c": description,
        "Case__c": caseId
    }
    const createFeedbackRequest = {
        method: 'POST',
        body: createFeedbackData,
        uri: API_URI + '/sobjects/Survey_Response__c',
        headers: {
            'content-type': 'application/json',
            "Authorization": "Bearer " + api.getJWTToken()
        },
        json: true
    };
    logger.debug(`createFeedbackRequest: ${JSON.stringify(createFeedbackRequest)}`);
    return request(createFeedbackRequest).then(function (response) {
        logger.trace(`Create Feedback response: ${JSON.stringify(response)}`);
        const configuredBrandFamilyInformation = context.session.BotUserSession.brand_family_information;
        const brandFamilyInformation = new BrandFamilyInformation(configuredBrandFamilyInformation);
        const isProduction = context.session.BotUserSession.ENVIRONMENT === 'production';
        const productCode = context.entities.BeverageType;

        let brandId = brandFamilyInformation.getSalesforceCodeFromProductCode(productCode, isProduction);
        let contactId = data.context.contactId;
        logger.info(`Update contactId ${contactId} with survey results`)
        let caseUpdatePayload = {
            "Status": "Closed",
            "Origin": "Chat",
            "B2C_Brand__c": brandId,
            "Priority": "Medium",
            "RecordType": {
                "Name": "Inquiry"
            },
            "B2C_Do_Not_Communicate_For_This_Case__c": "true",
            "B2C_Subject1__c": "Availability",
            "ContactId": contactId
        }
        let caseUpdateRequest = {
            method: 'PATCH',
            body: caseUpdatePayload,
            uri: API_URI + '/sobjects/case/' + caseId,
            headers: {
                'content-type': 'application/json',
                "Authorization": "Bearer " + api.getJWTToken()
            },
            json: true
        };
        logger.debug(`caseUpdateRequest: ${JSON.stringify(caseUpdateRequest)}`);
        request(caseUpdateRequest).then(function (response) {
            logger.debug(`Case update for ${caseId}, ${JSON.stringify(response)}`);
            return data;
        }).catch(function (error) {
            logger.error(JSON.stringify(error))
        });
    }).catch(function (error) {
        logger.error(JSON.stringify(error))
    });
}

/**
 *
 * @param requestId
 * @param data
 * @param cb
 */
function onUserMessage(requestId, data, cb) {
    const visitorId = _.get(data, 'channel.from');
    logger.debug(`visitor id: ${visitorId}`);

    // Seeding the access token from Salesforce
    // TODO: This may be redudant since the access token is seeded in the on Bot message handler
    api.getJWTToken();

    // TODO: Cleaner and clearer reason to do this. Does this have something to do with the difference
    //       between the web channel and the RTM channel.
    logger.trace(`data.channel: ${JSON.stringify(data.channel)}`);
    if (data.channel && !data.channel.channelInfos) {
        data.channel.channelInfos = {
            from: visitorId
        }
    }

    // If there exist an entry for the given visitorId then that indicates the
    // visitor is currently exchanging messages with the agent
    redisOperations.getRedisData("entry:" + visitorId).then(async function (entry) {
        if ((data.message && data.message === "#session_closed") || (data.message && data.message.toLowerCase() === "quit")) {
            logger.info(`Closing agent chat for vistorId: ${visitorId}`)
            closeAgentChat(data, entry, visitorId)
        }

        if (entry) {
            let session_key = entry.session_key;
            let affinity_token = entry.affinity_token;
            let message = {
                text: data.message
            }
            logger.debug(`Visitor: ${visitorId} sending to chat to Agent, message: ${data.message}`);
            data.context.session_key = session_key;
            data.context.affinity_token = affinity_token;
            VisitorTimeOutEvent.add(data);

            // Send the text type by the visitor to the agent via Salesforce chat API
            return api.sendMsg(session_key, affinity_token, message).catch(function (error) {
                logger.error(error);
                clearAgentNotification(data, visitorId);
            })
        } else {
            // TODO: Not sure what this doing
            if (data.message === '*' || data.message === '**' || data.message === '***' || data.message === '****' || data.message === '*****') {
                logger.debug(`stars replaced---> ${data.message}`);
                data.message = data.message.length + "";
            }
            sdk.clearAgentSession(data).then(function () {
                return sdk.sendBotMessage(data, cb);
            });
        }
    });
}

const FAQ_CASE_UPDATE = "FAQ";
const FAQ_SUBJECT1 = "General";
const FAQ_SUBJECT2 = "Product";
function onEvent(requestId, data, callback) {
    if (data.event.eventType === 'endFAQ') {
        // Extract the brand family information from the bot context
        const configuredBrandFamilyInformation = data.context.session.BotUserSession.brand_family_information;

        // Make an instance of the BrandFamilyInformation to access the brand family information
        const brandFamilyInformation = new BrandFamilyInformation(configuredBrandFamilyInformation);

        // Identifies the specific update
        data.context.session.BotUserSession.case_update = FAQ_CASE_UPDATE;

        // Set the respective subjects
        data.context.session.BotUserSession.case_subject1 = FAQ_SUBJECT1;
        data.context.session.BotUserSession.case_subject2 = FAQ_SUBJECT2;

        // Get the currently selected beverage
        data.context.session.BotUserSession.case_beverage_type = brandFamilyInformation.getDefaultBrand();

        logger.debug(`caseUpdate: ${FAQ_CASE_UPDATE}, subject1: ${FAQ_SUBJECT1}, subject2: ${FAQ_SUBJECT2}, beverage_type: ${brandFamilyInformation.getDefaultBrand()}`);
        handleUpdateCase(data);
    }
}

/**
 *
 * @param data Conttext from the bot
 * @param entry
 * @param visitorId
 * @returns {bluebird<void>}
 */
async function closeAgentChat(data, entry, visitorId) {
    logger.debug("<-------close agent initiated----->");
    try {
        if (entry) {
            let session_key = entry.session_key;
            let affinity_token = entry.affinity_token;
            await api.endChat(session_key, affinity_token);
        }
    }
    catch (error) {
        logger.error(`|closeAgentChat | BotKit.js | ${error}`);
    }
    clearAgentNotification(data, visitorId);
}

/**
 *
 * @param data
 */
function closeChat(data) {
    VisitorTimeOutEvent.delete(data);
    let visitorId = _.get(data, 'channel.channelInfos.from');
    if (!visitorId) {
        visitorId = _.get(data, 'channel.from');
    }
    redisOperations.deleteRedisData("entry:" + visitorId)
    redisOperations.deleteRedisData("data:" + visitorId)
    redisOperations.deleteRedisData("connected:" + visitorId)
    sdk.sendUserMessage(data).then(() => {
        sdk.clearAgentSession(data).then(() => {
            //console.log("| closeChat | BotKit.js | ClearAgentSession |", visitorId);
        });
    })

}

/**
 *
 * @param data
 * @param visitorId
 */
function clearAgentNotification(data, visitorId) {
    logger.debug(`|clearAgentNotification | BotKit.js | ${visitorId}`);
    try {
        sdk.clearAgentSession(data);
        redisOperations.deleteRedisData("entry:" + visitorId);
        redisOperations.deleteRedisData("data:" + visitorId);
        redisOperations.deleteRedisData("connected:" + visitorId);
        data.message = messageConf.sessionClosedMsg;
        data.overrideMessagePayload = null;
        sdk.sendUserMessage(data);
    }
    catch (error) {
        console.error(`|clearAgentNotification | BotKit.js | ${error}`);
    }
}

/**
 *
 * @param requestId
 * @param data
 * @param callback
 */
// function onAgentTransfer(requestId, data, callback) {
//     connectToAgent(requestId, data, callback);
// }

/**
 *
 * @param e
 * @returns {bluebird<void>}
 */
async function shutdown(e) {
    // Close connection to the Redis database
    try {
        redisOperations.closeConnection();
    }
    catch (e) {
        this.e = e;
        console.error("|shutdown | BotKit.js | Closing Redis connection Error|", e);
    }
    if (e) {
        process.exit(1); // Non-zero failure code
    } else {
        //console.log("|shutdown | BotKit.js | Closing Redis connection success");
        process.exit(0);
    }
}

/**
 *
 * @returns {bluebird<void>}
 */
async function startup() {
    logger.info(`Starting up bot kit application with process id: ${process.pid}`);
    restartPolling();
}

function restartPolling() {
    // Restarting long Polling for all the active sessions
    logger.debug('|restartPolling | BotKit.js | ');
    redisOperations.getRedisKeys().then(function (keys) {
        logger.debug(`|restartPolling | BotKit.js | Count ${keys.length}`);
        for (let i = 0 ; i < keys.length ; i++) {
            redisOperations.getRedisData(keys[i]).then(function (data) {
                getPendingMessages(data.visitorId, data.session_key, data.affinity_token).then()
                    .catch(function (error) {
                        logger.error(`###########${JSON.stringify(error)}`);
                        logger.error(`|restartPolling | BotKit.js | error while restarting polling for ${data.visitorId}, ${error}`);
                    });
            });
        }
    });
}
startup();
process.on('SIGTERM', () => {
    console.log("|SIGTERM | BotKit.js");
    shutdown();
});

process.on('SIGINT', () => {
    console.log("|SIGINT | BotKit.js");
    shutdown();
});

process.on('uncaughtException', error => {
    console.error(`|uncaughtException | BotKit.js | ${error}`);
});

module.exports = {
    botId: botId,
    botName: botName,
    closeChat: function (data) {
        //VisitorTimeOutEvent.delete(data);
        var visitorId = _.get(data, 'channel.channelInfos.from');
        if (!visitorId) {
            visitorId = _.get(data, 'channel.from');
        }
        console.debug("close chat for ", visitorId);
        stopChat(data, visitorId);
        // delete userResponseDataMap[visitorId];
        // delete _map[visitorId];
        // // sdk.clearAgentSession(data);
        sdk.sendUserMessage(data);
        /*.then(() => {
            sdk.clearAgentSession(data).then(() => {
                return;
            });
        })*/
    },
    on_user_message: function (requestId, data, callback) {
        logger.trace(`on_user_message(): requestId: ${requestId}, message: ${data.message}`);
        onUserMessage(requestId, data, callback);
    },
    on_bot_message: function (requestId, data, callback) {
        logger.trace(`on_bot_message(): requestId: ${requestId}, message: ${data.message}`);
        onBotMessage(requestId, data, callback);
    },
    on_agent_transfer: function (requestId, data, callback) {
        logger.trace(`on_agent_transfer(): requestId: ${requestId}`);
        onAgentTransfer(requestId, data, callback);
    },
    on_webhook: function (requestId, data, componentId, callback) {
        logger.trace(`on_webhook(): requestId: ${requestId} componentId: ${componentId}`);
        if (componentId === "sfAPIInvocation") {
            try {
                salesforceAPIInvocation(data, callback).then(function (response) {
                        logger.trace(`response: ${JSON.stringify(response)}`);
                        callback(null, data)
                    }
                );
            } catch (err) {
                logger.error("error in calling salesforceAPIInvocation", err);
            }
        }

        if (componentId === "sfCreateCase") {
            try {
                createCase(data, callback).then(function (response) {
                        logger.trace(`Response from createCase(): ${JSON.stringify(response)}`);
                        callback(null, data);
                    }
                );
            } catch (error) {
                logger.error(`error ${error}`);
            }
        }

        if (componentId === "sfGetCaseNumber") {
            try {
                getCaseNumber(data, callback).then(function (response) {
                        logger.trace(`Response from getCaseNumber(): ${JSON.stringify(response)}`)
                        callback(null, data);
                    }
                );
            } catch (error) {
                logger.error(`error: ${error}`);
            }
        }

        if (componentId === "FeedbackHook") {
            try {
                gatherFeedback(data, callback).then(function (response) {
                        callback(null, data)
                    }
                );
            } catch (err) {
                logger.error(`error: ${err}`);
            }
        }
    },
    on_event: function (requestId, data, callback) {
        logger.info(`on_event(): ${JSON.stringify(data.event)}, ${data.context.intent}`);
        onEvent(requestId, data, callback);
        return callback(null, data);
    }
};
