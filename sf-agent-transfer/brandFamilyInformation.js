const log4js = require("log4js");
const logger = log4js.getLogger();

/**
 * Helper Class to get information from the specific brand family data
 * used by the bot.
 */

class BrandFamilyInformation {

    /**
     * Initialize the instance with the brand family information
     * @param brand_family_information - Dictionary of a specific brand (e.g. Budweiser, Natural Light, Busch, etc)
     *
     * NOTE: Callers of this class need to assume the following:
     *       1) The brand_family_information provide is valid
     *       2) There are list of beverages and not undefined
     */
    constructor(brand_family_information) {
        this.brand_family_information = brand_family_information;
    }

    /**
     * Collects the different Salesforce codes corresponding to the
     * product code passed to the method.
     *
     * @param product_code - Three-letter code standard by AB InBev representing
     *                       a specific beverage.
     * @param production - Either true or false (default: true) true returns the production code
     *                     false returns the stage code.
     * @returns {*[]}
     */
    getSalesforceCodeFromProductCode(product_code, production=true) {
        let sfdc_code;
        // Place the current brand family information
        let brandFamilyInformation = this.brand_family_information;
        let beverages = brandFamilyInformation.beverages;
        for (let i = 0 ; i < beverages.length ; i++) {
            let beverage = beverages[i];
            if (beverage.product_code === product_code) {
                logger.debug(`sfdc_code_prod: ${beverage.sfdc_code_prod}, sfdc_code_stage: ${beverage.sfdc_code_stage}`);
                if (production) {
                    sfdc_code = beverage.sfdc_code_prod;
                } else {
                    sfdc_code = beverage.sfdc_code_stage;
                }
            }
        }
        return sfdc_code;
    }

    /**
     * Returns the default beverage brand as a product code
     *
     * @returns string
     */
    getDefaultBrand() {
        return this.brand_family_information.brand_default;
    }

    /**
     *  Returns the domain associated with the brand family.
     **
     * @returns string
     */
    getWebsite() {
        return this.brand_family_information.site_domain_name;
    }

}

module.exports = BrandFamilyInformation;