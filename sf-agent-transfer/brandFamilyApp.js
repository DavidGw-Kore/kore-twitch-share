const bot = require("./config.json").bot;
const botId = bot.id;
const botName = bot.name;
const sdk = require("./lib/sdk");
const config = require('./config.json');

// Utility class to get brand family information
const BrandFamilyInformation = require("./brandFamilyInformation");


//
// Use better logging than just console.log
//
// See https://log4js-node.github.io/log4js-node/ for more information
//     on the usage of this library
//
const log4js = require("log4js");
const logger = log4js.getLogger();
logger.level = "debug"; // default level is OFF - which means no logs at all.
logger.debug("Loading Brand Family Application");

module.exports = {
    botId: botId,
    botName: botName,
    closeChat: function (data) {
        logger.debug('closeChat');
    },
    on_user_message: function (requestId, data, callback) {
        logger.debug('on_user_message');
        sdk.sendBotMessage(data, callback)
    },
    on_bot_message: function (requestId, data, callback) {
        logger.debug('on_bot_message');
        sdk.sendUserMessage(data, callback);
    },
    on_agent_transfer: function (requestId, data, callback) {
        logger.debug("on_agent_transfer");
        return callback(null, data);
    },
    on_webhook: function (requestId, data, componentId, callback) {
        logger.debug(`requestId: ${requestId}`);
        logger.debug(`componentId: ${componentId}`);
        logger.debug(`ProductCode: ${data.context.entities.ProductCode}`);
        logger.debug("on_webhook")

        // Lookup the Salesforce codes for a given product code
        if (componentId === "GetSalesforceCodes") {
            logger.debug(`${data.context.entities.ProductCode}`)
            let db = new BrandFamilyInformation(data.context.session.BotUserSession.brand_family_information);
            const sfdc_code = db.getSalesforceCodeFromProductCode(data.context.entities.ProductCode);
            data.context.sfdc_code = sfdc_code
        }
        callback(null, data);
    },
    on_event: function (requestId, data, callback) {
        logger.debug("on_event");
        return callback(null, data);
    }
};