import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { ArmObj } from 'app/shared/models/arm/arm-obj';
import { Site } from 'app/shared/models/arm/site';
import { SiteConfig } from "app/shared/models/arm/site-config";
import { AuthzService } from 'app/shared/services/authz.service';
import { SiteService } from 'app/shared/services/site.service';

export interface SlotPermissions {
    hasWritePermission?: boolean,
    hasSwapPermission?: boolean,
    hasReadOnlyLock?: boolean
}

export interface SlotEntry {
    siteArm?: ArmObj<Site>,
    siteConfigArm?: ArmObj<SiteConfig>,
    permissions?: SlotPermissions,
    targetSwapSlotSubject?: Subject<string>,
    siteAuthEnabledSubject?: Subject<boolean>,
    permissionsSubject?: Subject<SlotPermissions>
}

export class SlotsInfoCache {
    constructor(
        private _authZService: AuthzService,
        private _siteService: SiteService
    ) {
        this._slotsMap = {};
    }

    private _slotsMap: { [key: string]: SlotEntry };

    private _getSlotEntry(resourceId: string): SlotEntry {
        if (!resourceId) {
            return null;
        }

        if (!this._slotsMap[resourceId]) {
            this._slotsMap[resourceId] = {};
        }

        return this._slotsMap[resourceId];
    }

    public getTargetSwapSlot(resourceId: string): Observable<string> {
        const slotEntry: SlotEntry = this._getSlotEntry(resourceId);
        if (!slotEntry) {
            return Observable.of(null);
        }

        if (slotEntry.siteArm) {
            return Observable.of(slotEntry.siteArm.properties.targetSwapSlot);
        } else if (slotEntry.targetSwapSlotSubject !== undefined) {
            return slotEntry.targetSwapSlotSubject;
        } else {
            slotEntry.targetSwapSlotSubject = new Subject<string>();
            this._siteService.getSite(resourceId).subscribe(r => {
                if (r.isSuccessful) {
                    slotEntry.siteArm =  r.result;
                    slotEntry.targetSwapSlotSubject.next(slotEntry.siteArm.properties.targetSwapSlot);
                } else {
                    slotEntry.targetSwapSlotSubject.next(null);
                }
                slotEntry.targetSwapSlotSubject.complete();
                delete slotEntry.targetSwapSlotSubject;
            });
            return slotEntry.targetSwapSlotSubject;
        }
    }

    public getSiteAuthEnabled(resourceId: string): Observable<boolean> {
        const slotEntry: SlotEntry = this._getSlotEntry(resourceId);
        if (!slotEntry) {
            return Observable.of(null);
        }

        if (slotEntry.siteConfigArm) {
            return Observable.of(slotEntry.siteConfigArm.properties.siteAuthEnabled);
        } else if (slotEntry.siteAuthEnabledSubject !== undefined) {
            return slotEntry.siteAuthEnabledSubject;
        } else {
            slotEntry.siteAuthEnabledSubject = new Subject<boolean>();
            this._siteService.getSiteConfig(resourceId).subscribe(r => {
                if (r.isSuccessful) {
                    slotEntry.siteConfigArm = r.result;
                    slotEntry.siteAuthEnabledSubject.next(slotEntry.siteConfigArm.properties.siteAuthEnabled);
                } else {
                    slotEntry.siteAuthEnabledSubject.next(false);
                }
                slotEntry.siteAuthEnabledSubject.complete();
                delete slotEntry.siteAuthEnabledSubject;
            });
            return slotEntry.siteAuthEnabledSubject;
        }
    }

    public getPermissions(resourceId: string): Observable<SlotPermissions> {
        const slotEntry: SlotEntry = this._getSlotEntry(resourceId);
        if (!slotEntry) {
            return Observable.of(null);
        }

        if (slotEntry.permissions !== undefined) {
            return Observable.of(slotEntry.permissions);
        } else if (slotEntry.permissionsSubject !== undefined) {
            return slotEntry.permissionsSubject;
        } else {
            slotEntry.permissionsSubject = new Subject<SlotPermissions>();
            Observable.zip(
                this._authZService.hasPermission(resourceId, [AuthzService.writeScope]),
                this._authZService.hasPermission(resourceId, [AuthzService.actionScope]),
                this._authZService.hasReadOnlyLock(resourceId))
                .subscribe(r => {
                    slotEntry.permissions = {
                        hasWritePermission: r[0],
                        hasSwapPermission: r[1],
                        hasReadOnlyLock: r[2]
                    }
                    slotEntry.permissionsSubject.next(slotEntry.permissions);
                    slotEntry.permissionsSubject.complete();
                    delete slotEntry.permissionsSubject;
            });
            return slotEntry.permissionsSubject;
        }
    }

    public setSiteArm(resourceId: string, siteArm: ArmObj<Site>) {
        if (!resourceId || !siteArm) {
            throw `Parameters 'resourceId' and 'siteArm' are required`;
        }

        if (this._slotsMap[resourceId]) {
            this._slotsMap[resourceId].siteArm = siteArm;
        } else {
            this._slotsMap[resourceId] = { siteArm: siteArm };
        }
    }
}