var messageConf = require("./message.json")
var config = require("./config.json")
//const nodemailer = require('nodemailer');

// var details = {
//     host: config.email.host,
//     port: config.email.port,
//     secure: config.email.secure, // true for 465 port, false for other ports
//     auth: {
//         user: config.email.userName,
//         pass: config.email.password
//     }
// }
function isValidDate(startDate, endDate) {
    var currentDate = new Date();

    var startDate = new Date(startDate);
    var endDate = new Date(endDate);

    if (currentDate > startDate && currentDate < endDate) {
        return true;
    }
    else {
        return false;
    }
}
//let transporter = nodemailer.createTransport(details);

function IsJsonString(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

function isEmpty(obj) {
    for (var prop in obj) {
        if (obj.hasOwnProperty(prop))
            return false;
    }
    return JSON.stringify(obj) === JSON.stringify({});
}



function getHistoryString(messages) {
    var historyIgnoreMessages = [];
    return new Promise(function (resolve, reject) {
        try {
            var str = "";
            messages = messages.length > 0 ? messages : [];
            messages.forEach(function (message) {
                if (message.components && message.components[0].cT == "text")
                    var text = message.components[0].data.text;
                if (IsJsonString(text) && isNaN(text)) {
                    var template = JSON.parse(text);
                    if (template && template.payload.template_type === "button") {
                        str = str + "Bot: " + template.payload.text + "\n";
                        template.payload.buttons.forEach(function (button) {
                            str = str + "       " + button.title + "\n";
                        });
                    } else if (template && template.payload.template_type === "live_agent") {
                        str = str + "Bot: " + template.payload.text + "\n";
                    } else {

                    }
                    str = str + "\n";
                } else {
                    if (message.type === "incoming" && !(historyIgnoreMessages && historyIgnoreMessages.indexOf(text.trim().toUpperCase()) > -1)) {
                        str = str + "Visitor: " + text + "\n\n";
                    } else if (message.type === "outgoing") {
                        str = str + "Bot: " + text + "\n\n";
                    }
                }

            });
            resolve(str);
        }
        catch (error) {
            reject(error);
        }
    });
}

function hasWelcome(messages) {
    for (var i = 0; i < messages.length; i++) {
        if (messages[i].components[0].data.text == messageConf.welcomeMessage.nl || messages[i].components[0].data.text == messageConf.welcomeMessage.en1 || messages[i].components[0].data.text == messageConf.welcomeMessage.en2) {
            return i;
        }
    }
    return false;
}
// function sendEmail(mailOptions) {
//     console.log("|sendEmail | utils.js | ", mailOptions.to)
//     return new Promise(
//         function (resolve, reject) {
//             transporter.sendMail(mailOptions, (error, info) => {
//                 if (error) {
//                     console.error("sendEmail | utils.js | ", mailOptions, "| ", error)
//                     reject(error);
//                 }
//                 else {
//                     resolve("success");
//                 }
//             })
//         })
// }
module.exports = {
    getHistoryString: getHistoryString,
    isEmpty: isEmpty,
    IsJsonString: IsJsonString,
    hasWelcome: hasWelcome,
   // sendEmail: sendEmail,
    isValidDate: isValidDate
};
