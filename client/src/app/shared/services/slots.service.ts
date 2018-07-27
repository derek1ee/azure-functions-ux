import { Injectable } from '@angular/core';
import { ArmService } from './arm.service';
import { CacheService } from './cache.service';
import { ArmObj } from '../models/arm/arm-obj';
import { Constants } from '../../shared/models/constants';
import { SiteConfig } from "app/shared/models/arm/site-config";

@Injectable()
export class SlotsService {
    constructor(
        private _cacheService: CacheService,
        private _armService: ArmService
    ) { }

    // Create Slot
    createNewSlot(siteId: string, slotName: string, loc: string, serverfarmId: string, config?: SiteConfig) {
        if (config) {
            config.experiments = null;
            (config as any).routingRules = null;
        }

        // create payload
        const payload = JSON.stringify({
            location: loc,
            properties: {
                serverFarmId: serverfarmId,
                siteConfig: config || null
            }
        });
        return this._cacheService.putArm(`${siteId}/slots/${slotName}`, this._armService.websiteApiVersion, payload);
    }


    public setStatusOfSlotOptIn(appSetting: ArmObj<any>, value?: string) {
        appSetting.properties[Constants.slotsSecretStorageSettingsName] = value;
        return this._cacheService.putArm(appSetting.id, this._armService.websiteApiVersion, appSetting);
    }
}
