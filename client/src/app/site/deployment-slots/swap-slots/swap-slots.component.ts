import { Component, Injector, Input, OnDestroy, Output } from '@angular/core';
import { Response } from '@angular/http';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { FormBuilder, FormGroup } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { FeatureComponent } from 'app/shared/components/feature-component';
import { ArmObj, ResourceId, ArmArrayResult } from 'app/shared/models/arm/arm-obj';
import { Site } from 'app/shared/models/arm/site';
import { SlotsDiff } from 'app/shared/models/arm/slots-diff';
import { LogCategories, SiteTabIds } from 'app/shared/models/constants';
import { DropDownElement } from 'app/shared/models/drop-down-element';
import { PortalResources } from 'app/shared/models/portal-resources';
import { ArmSiteDescriptor } from 'app/shared/resourceDescriptors';
import { AuthzService } from 'app/shared/services/authz.service';
import { CacheService } from 'app/shared/services/cache.service';
import { LogService } from 'app/shared/services/log.service';
import { SiteService } from 'app/shared/services/site.service';

// TODO [andimarc]: disable all controls when a swap operation is in progress
// TODO [andimarc]: disable controls when in phaseTwo or complete

export type OperationType = 'slotsswap' | 'applySlotConfig' | 'resetSlotConfig';

export interface SwapSlotParameters {
    operationType: OperationType,
    uri: string,
    srcName: string,
    destName: string,
    swapType: string,
    previewLink?: string,
    content?: any
}


interface SlotInfo {
    siteArm: ArmObj<Site>,
    hasSwapAccess?: boolean,
    hasSiteAuth?: boolean
}

@Component({
    selector: 'swap-slots',
    templateUrl: './swap-slots.component.html',
    styleUrls: ['./swap-slots.component.scss', './../common.scss']
})
export class SwapSlotsComponent extends FeatureComponent<ResourceId> implements OnDestroy {
    @Input() set resourceIdInput(resourceId: ResourceId) {
        this._resourceId = resourceId;
        this.setInput(resourceId);
    }

    @Output() close: Subject<SwapSlotParameters>;

    public dirtyMessage: string;
    public isLoading = true;
    public loadingFailed = false;

    public Resources = PortalResources;
    public srcDropDownOptions: DropDownElement<string>[];
    public destDropDownOptions: DropDownElement<string>[];
    public siteResourceId: ResourceId;
    public siteName: string;

    public hasStickySettings = false;

    public srcPermissionsMessage: string;
    public destPermissionsMessage: string;

    /*
        public slotsNotUnique: boolean;
        public srcNotSelected: boolean;
        public srcNoSwapAccess: boolean;
        public destNotSelected: boolean;
        public destNoSwapAccess: boolean;
        public siteAuthConflicts: string[];
        public isValid: boolean;
    */
    public previewLink: string;

    public phase: null | 'phaseOne' | 'phaseTwo' | 'complete';

    public successMessage = null;

    public checkingSrc: boolean;
    public checkingDest: boolean;
    public loadingDiffs: boolean;
    public swapping: boolean;

    public slotsDiffs: SlotsDiff[];
    public diffsPreviewSlot: 'source' | 'target' = 'source';

    public swapForm: FormGroup;

    private _swappedOrCancelled: boolean;

    private _diffSubject: Subject<string>;

    private _slotsMap: { [key: string]: SlotInfo };

    private _resourceId: ResourceId;

    constructor(
        private _authZService: AuthzService,
        private _cacheService: CacheService,
        private _fb: FormBuilder,
        private _logService: LogService,
        private _siteService: SiteService,
        private _translateService: TranslateService,
        injector: Injector
    ) {
        super('SwapSlotsComponent', injector, SiteTabIds.deploymentSlotsConfig);

        this.close = new Subject<SwapSlotParameters>();

        // TODO [andimarc]
        // For ibiza scenarios, this needs to match the deep link feature name used to load this in ibiza menu
        this.featureName = 'deploymentslots';
        this.isParentComponent = true;

        this._setupSubscriptions();

        const srcIdCtrl = this._fb.control({ value: null, disabled: true });
        const srcConfigCtrl = this._fb.control({ value: null, disabled: true });

        const destIdCtrl = this._fb.control({ value: null, disabled: true });
        const desConfigCtrl = this._fb.control({ value: null, disabled: true });

        const multiPhaseCtrl = this._fb.control({ value: false, disabled: true });

        this.swapForm = this._fb.group({
            srcId: srcIdCtrl,
            srcConfig: srcConfigCtrl,
            destId: destIdCtrl,
            desConfig: desConfigCtrl,
            multiPhase: multiPhaseCtrl,
        });
    }

    protected setup(inputEvents: Observable<ResourceId>) {
        return inputEvents
            .distinctUntilChanged()
            .switchMap(resourceId => {
                this._resourceId = resourceId;

                this.previewLink = null;

                this.isLoading = true;
                this.loadingFailed = false;

                this.successMessage = null;

                this.swapping = false;

                this.srcPermissionsMessage = null;
                this.destPermissionsMessage = null;

                this.srcDropDownOptions = [];
                this.destDropDownOptions = [];
                this._slotsMap = {};

                this._swappedOrCancelled = false;

                this._resetForm();

                const siteDescriptor = new ArmSiteDescriptor(resourceId);
                this.siteResourceId = siteDescriptor.getSiteOnlyResourceId();
                this.siteName = siteDescriptor.site;

                return Observable.zip(
                    this._siteService.getSite(this.siteResourceId),
                    this._siteService.getSlots(this.siteResourceId),
                    this._siteService.getSlotConfigNames(this.siteResourceId),
                    this._siteService.getSiteConfig(this._resourceId)
                );
            })
            .mergeMap(r => {
                const siteResult = r[0];
                const slotsResult = r[1];
                const slotConfigNamesResult = r[2];
                const siteConfigResult = r[3];

                if (!siteResult.isSuccessful) {
                    this._logService.error(LogCategories.swapSlots, '/swap-slots', siteResult.error.result);
                    this.loadingFailed = true;
                }
                if (!slotsResult.isSuccessful) {
                    this._logService.error(LogCategories.swapSlots, '/swap-slots', slotsResult.error.result);
                    this.loadingFailed = true;
                }
                if (!slotConfigNamesResult.isSuccessful) {
                    this._logService.error(LogCategories.swapSlots, '/swap-slots', slotConfigNamesResult.error.result);
                    this.loadingFailed = true;
                }
                if (!siteConfigResult.isSuccessful) {
                    this._logService.error(LogCategories.swapSlots, '/swap-slots', siteConfigResult.error.result);
                    this.loadingFailed = true;
                }

                if (!this.loadingFailed) {
                    let destId: string = null;
                    const options: DropDownElement<string>[] = [];

                    [siteResult.result, ...slotsResult.result.value].forEach(s => {
                        this._slotsMap[s.id] = { siteArm: s };
                        destId = (!destId && s.id !== this._resourceId) ? s.id : destId;
                        options.push({
                            displayLabel: s.properties.name,
                            value: s.id
                        });
                    })

                    this._slotsMap[this._resourceId].hasSiteAuth = siteConfigResult.result.properties.siteAuthEnabled;

                    // check for sticky settings
                    const appSettingNames = slotConfigNamesResult.result.properties.appSettingNames || [];
                    const connectionStringNames = slotConfigNamesResult.result.properties.connectionStringNames || [];
                    this.hasStickySettings = appSettingNames.length > 0 || connectionStringNames.length > 0


                    // check for targetSwapSlot
                    const currSlot = this._slotsMap[this._resourceId];
                    const targetSwapSlot = currSlot ? currSlot.siteArm.properties.targetSwapSlot : null;

                    if (targetSwapSlot) {
                        // We're already in Phase2
                        destId = targetSwapSlot.toLowerCase() === 'production' ?
                            this.siteResourceId :
                            this.siteResourceId + '/slots/' + targetSwapSlot.toLowerCase();
                    }

                    this.srcDropDownOptions = JSON.parse(JSON.stringify(options));
                    this.srcDropDownOptions.forEach(o => o.default = o.value === this._resourceId);

                    this.destDropDownOptions = JSON.parse(JSON.stringify(options));
                    this.destDropDownOptions.forEach(o => o.default = o.value === destId);

                    return Observable.zip(
                        Observable.of(!!targetSwapSlot),
                        Observable.of(destId),
                        !targetSwapSlot ? Observable.of(null) : this._authZService.hasPermission(this._resourceId, [AuthzService.writeScope]),
                        !targetSwapSlot ? Observable.of(null) : this._authZService.hasPermission(this._resourceId, [AuthzService.actionScope]),
                        !targetSwapSlot ? Observable.of(null) : this._authZService.hasReadOnlyLock(this._resourceId),
                        !targetSwapSlot ? Observable.of(null) : this._authZService.hasPermission(destId, [AuthzService.writeScope]),
                        !targetSwapSlot ? Observable.of(null) : this._authZService.hasPermission(destId, [AuthzService.actionScope]),
                        !targetSwapSlot ? Observable.of(null) : this._authZService.hasReadOnlyLock(destId)
                    );

                } else {
                    return Observable.of(null);
                }
            })
            .do(r => {
                if (r) {

                    const isPhaseTwo = r[0];
                    const destId = r[1];

                    if (isPhaseTwo) {
                        this.swapForm.controls['srcId'].setValue(this._resourceId);
                        this.swapForm.controls['destId'].setValue(destId);

                        const srcWritePermission = r[2];
                        const srcSwapPermission = r[3];
                        const srcReadOnlyLock = r[4];
                        const destWritePermission = r[5];
                        const destSwapPermission = r[6];
                        const destReadOnlyLock = r[7];


                        if (!srcWritePermission) {
                            this.srcPermissionsMessage = this._translateService.instant('no write permission on slot \'{0}\'');
                        } else if (srcSwapPermission) {
                            this.srcPermissionsMessage = this._translateService.instant('no swap permission on slot \'{0}\'');
                        } else if (srcReadOnlyLock) {
                            this.srcPermissionsMessage = this._translateService.instant('read-only lock on slot \'{0}\'');
                        } else {
                            this.srcPermissionsMessage = '';
                        }


                        if (!destWritePermission) {
                            this.destPermissionsMessage = this._translateService.instant('no write permission on slot \'{0}\'');
                        } else if (destSwapPermission) {
                            this.destPermissionsMessage = this._translateService.instant('no swap permission on slot \'{0}\'');
                        } else if (destReadOnlyLock) {
                            this.destPermissionsMessage = this._translateService.instant('read-only lock on slot \'{0}\'');
                        } else {
                            this.destPermissionsMessage = '';
                        }


                    } else {
                        this._setupForm();
                        this.swapForm.controls['srcId'].setValue(this._resourceId);
                        this.swapForm.controls['destId'].setValue(destId);
                    }
                }

                this.isLoading = false;
            });
    }

    private _resetForm() {
        const srcIdCtrl = this.swapForm.get('srcId');
        const srcConfigCtrl = this.swapForm.get('srcConfig');
        const destIdCtrl = this.swapForm.get('destId');
        const destConfigCtrl = this.swapForm.get('destConfig');
        const multiPhaseCtrl = this.swapForm.get('multiPhase');

        [srcIdCtrl, srcConfigCtrl, destIdCtrl, destConfigCtrl, multiPhaseCtrl].forEach(ctrl => {
            ctrl.clearValidators();
            ctrl.clearAsyncValidators();
            ctrl.setValue(null);
            ctrl.disable();
        });
    }

    private _setupForm() {
        const srcIdCtrl = this.swapForm.get('srcId');
        const srcConfigCtrl = this.swapForm.get('srcConfig');
        const destIdCtrl = this.swapForm.get('destId');
        const destConfigCtrl = this.swapForm.get('destConfig');
        const multiPhaseCtrl = this.swapForm.get('multiPhase');

        srcIdCtrl.enable();
        //setup validators

        srcConfigCtrl.enable();

        destIdCtrl.enable();
        //setup validators

        destConfigCtrl.enable();

        if (this.hasStickySettings) {
            multiPhaseCtrl.enable();
            //setup validators
        }
    }


    private _setupSubscriptions() {
        this._diffSubject = new Subject<string>();
        this._diffSubject
            .takeUntil(this.ngUnsubscribe)
            .distinctUntilChanged()
            .switchMap(s => {
                this.loadingDiffs = true;
                const list = s.split(',');
                return this._getSlotsDiffs(list[0], list[1]);
            })
            .subscribe(r => {
                this.loadingDiffs = false;
                this.slotsDiffs = !r ? null : r.value.map(o => o.properties);
            });

        const srcCtrl = this._fb.control({ value: null, disabled: false });
        const destCtrl = this._fb.control({ value: null, disabled: false });
        const multiPhaseCtrl = this._fb.control({ value: false, disabled: false });

        this.swapForm = this._fb.group({
            src: srcCtrl,
            dest: destCtrl,
            multiPhase: multiPhaseCtrl
        });

        srcCtrl.valueChanges
            .takeUntil(this.ngUnsubscribe)
            .distinctUntilChanged()
            .switchMap(v => {
                this.checkingSrc = true;
                return this._getSlotInfo(srcCtrl.value);
            })
            .subscribe(slotInfo => {
                if (slotInfo) {
                    this._slotsMap[slotInfo.siteArm.id] = slotInfo;
                    this._validateAndDiff();
                }
                this.checkingSrc = false;
            });

        destCtrl.valueChanges
            .takeUntil(this.ngUnsubscribe)
            .distinctUntilChanged()
            .switchMap(v => {
                this.checkingDest = true;
                return this._getSlotInfo(destCtrl.value);
            })
            .subscribe(slotInfo => {
                if (slotInfo) {
                    this._slotsMap[slotInfo.siteArm.id] = slotInfo;
                    this._validateAndDiff();
                }
                this.checkingDest = false;
            });
    }

    private _validateAndDiff() {
        // TODO [andimarc]: user form validation instaed

        const src = this.swapForm ? this.swapForm.controls['srcId'].value : null;
        const dest = this.swapForm ? this.swapForm.controls['destId'].value : null;
        const multiPhase = this.swapForm ? this.swapForm.controls['multiPhase'].value : false;
        /*
                this.slotsNotUnique = src === dest;
                this.srcNotSelected = !src;
                this.destNotSelected = !dest;
                this.srcNoSwapAccess = !!src && this._slotsMap[src] && !this._slotsMap[src].hasSwapAccess;
                this.destNoSwapAccess = !!dest && this._slotsMap[dest] && !this._slotsMap[dest].hasSwapAccess;
        */
        const siteAuthConflicts: string[] = [];
        if (multiPhase) {
            [src, dest].forEach(r => {
                if (!!r && this._slotsMap[r] && this._slotsMap[r].hasSiteAuth) {
                    siteAuthConflicts.push(r);
                }
            })

        }
        /*       this.siteAuthConflicts = siteAuthConflicts.length === 0 ? null : siteAuthConflicts;
       
               // TODO [andimarc]: make sure neither src or dest slot have targetSwapSlot set (unless this is phase two of a swap and the value match up)
       
               this.isValid = !this.slotsNotUnique
                   && !this.srcNotSelected
                   && !this.destNotSelected
                   && !this.srcNoSwapAccess
                   && !this.destNoSwapAccess
                   && !this.siteAuthConflicts;
       
               if (this.isValid) {
                   this._diffSubject.next(`${src},${dest}`);
               }
       */
    }

    private _getSlotInfo(resourceId: ResourceId, force?: boolean): Observable<SlotInfo> {
        const slotInfo: SlotInfo = resourceId ? this._slotsMap[resourceId] : null;

        const needsFetch = slotInfo && (slotInfo.hasSiteAuth === undefined || slotInfo.hasSwapAccess === undefined);

        if (needsFetch || force) {
            return Observable.zip(
                this._authZService.hasPermission(slotInfo.siteArm.id, [AuthzService.writeScope]),
                this._authZService.hasPermission(slotInfo.siteArm.id, [AuthzService.actionScope]),
                this._authZService.hasReadOnlyLock(slotInfo.siteArm.id),
                this._siteService.getSiteConfig(slotInfo.siteArm.id))
                .mergeMap(r => {
                    const hasWritePermission = r[0];
                    const hasSwapPermission = r[1];
                    const hasReadOnlyLock = r[2];
                    const siteConfigResult = r[3];

                    const hasSwapAccess = hasWritePermission && hasSwapPermission && !hasReadOnlyLock;
                    const hasSiteAuth = siteConfigResult.result && siteConfigResult.result.properties.siteAuthEnabled;
                    return Observable.of({
                        siteArm: slotInfo.siteArm,
                        hasSiteAuth: hasSiteAuth,
                        hasSwapAccess: hasSwapAccess
                    });
                });
        } else {
            return Observable.of(slotInfo);
        }
    }

    cancel() {
        const confirmMsg = this._translateService.instant(PortalResources.unsavedChangesWarning);
        const close = (!this.swapForm || !this.swapForm.dirty || this.phase === 'complete') ? true : confirm(confirmMsg);

        if (close) {
            this.close.next(null);
        }
    }

    private _getSlotsDiffs(src: string, dest: string): Observable<ArmArrayResult<SlotsDiff>> {
        const srcDescriptor: ArmSiteDescriptor = new ArmSiteDescriptor(src);
        const path = srcDescriptor.getTrimmedResourceId() + '/slotsdiffs';

        const destDescriptor: ArmSiteDescriptor = new ArmSiteDescriptor(dest);
        const content = {
            targetSlot: destDescriptor.slot || 'production'
        }

        return this._cacheService.postArm(path, null, null, content)
            .mergeMap(r => {
                return Observable.of(r.json());
            })
            .catch(e => {
                return Observable.of(null);
            });
    }

    swap() {

        //this._submit('swap');
    }


    cancelMultiPhaseSwap() {
        this._submit('cancel');
    }

    slotsSwap(params: SwapSlotParameters) {

        //const operation = this._translateService.instant(PortalResources.swapOperation, { swapType: params.swapType, srcSlot: params.srcName, destSlot: params.destName });
        //const startMessage = this._translateService.instant(PortalResources.swapStarted, { operation: operation });

        this.setBusy();
        this.swapping = true;

        this._cacheService.postArm(params.uri, null, null, params.content)
            .mergeMap(r => {
                const location = r.headers.get('Location');
                if (!location) {
                    return Observable.of({ success: false, error: 'no location header' }); // TODO [andimarc]: use Resource string?
                } else {
                    return Observable.interval(1000)
                        .concatMap(_ => this._cacheService.get(location))
                        .map((r: Response) => r.status)
                        .take(30 * 60 * 1000)
                        .filter(s => s !== 202)
                        .map(r => { return { success: true, error: null } })
                        .catch(e => Observable.of({ success: false, error: e }))
                        .take(1);
                }
            })
            .catch(e => {
                return Observable.of({ success: false, error: e })
            })
            .subscribe(r => {
                this.dirtyMessage = null;
                this.clearBusy();
                this.swapping = false;

                /*
                let resultMessage = r.success ?
                    this._translateService.instant(PortalResources.swapSuccess, { operation: operation }) :
                    this._translateService.instant(PortalResources.swapFailure, { operation: operation, error: JSON.stringify(r.error) });
                */

                if (!r.success) {
                    this._logService.error(LogCategories.deploymentSlots, '/deployment-slots', r.error);
                    // TODO [andimarc]: display error message in an error info box?
                } else {
                    this._swappedOrCancelled = true;
                }
                // TODO [andimarc]: refresh the _slotsMap entries for the slot(s) involved in the swap
            });
    }

    applySlotConfig(params: SwapSlotParameters) {

        //const operation = this._translateService.instant(PortalResources.swapOperation, { swapType: params.swapType, srcSlot: params.srcName, destSlot: params.destName });
        //const startMessage = this._translateService.instant(PortalResources.swapStarted, { operation: operation });

        this.setBusy();
        this.swapping = true;

        this._cacheService.postArm(params.uri, null, null, params.content)
            .mergeMap(r => {
                return Observable.of({ success: true, error: null });
            })
            .catch(e => {
                return Observable.of({ success: false, error: e })
            })
            .subscribe(r => {
                this.dirtyMessage = null;
                this.clearBusy();
                this.swapping = false;

                /*
                let resultMessage = r.success ?
                    this._translateService.instant(PortalResources.swapSuccess, { operation: operation }) :
                    this._translateService.instant(PortalResources.swapFailure, { operation: operation, error: JSON.stringify(r.error) });
                */

                if (!r.success) {
                    this._logService.error(LogCategories.deploymentSlots, '/deployment-slots', r.error);
                    // TODO [andimarc]: display error message in an error info box?

                } else {
                    this.phase = 'phaseTwo';
                    this.previewLink = params.previewLink;
                    this._swappedOrCancelled = true;
                }
                // TODO [andimarc]: refresh the _slotsMap entries for the slot(s) involved in the swap
            });
    }

    resetSlotConfig(params: SwapSlotParameters) {

        //const operation = this._translateService.instant(PortalResources.swapOperation, { swapType: params.swapType, srcSlot: params.srcName, destSlot: params.destName });
        //const startMessage = this._translateService.instant(PortalResources.swapCancelStarted, { operation: operation });

        this.setBusy();
        this.swapping = true;

        this._cacheService.postArm(params.uri, null, null, params.content)
            .mergeMap(r => {
                return Observable.of({ success: true, error: null });
            })
            .catch(e => {
                return Observable.of({ success: false, error: e })
            })
            .subscribe(r => {
                this.dirtyMessage = null;
                this.clearBusy();
                this.swapping = false;

                /*
                let resultMessage = r.success ?
                    this._translateService.instant(PortalResources.swapCancelSuccess, { operation: operation }) :
                    this._translateService.instant(PortalResources.swapCancelFailure, { operation: operation, error: JSON.stringify(r.error) });
                */

                if (!r.success) {
                    this._logService.error(LogCategories.deploymentSlots, '/deployment-slots', r.error);
                    // TODO [andimarc]: display error message in an error info box?
                } else {
                    this._swappedOrCancelled = true;
                }
                // TODO [andimarc]: refresh the _slotsMap entries for the slot(s) involved in the swap
            });
    }

    public receiveSwapParams(params: SwapSlotParameters) {
        //this.swapControlsOpen = false;

        if (params) {
            this.dirtyMessage = this._translateService.instant(PortalResources.swapOperationInProgressWarning);

            const operation = this._translateService.instant(PortalResources.swapOperation, { swapType: params.swapType, srcSlot: params.srcName, destSlot: params.destName });

            //const startMessageResourceString = params.operationType === 'slotsswap' ? PortalResources.swapStarted : PortalResources.swapCancelStarted;
            //const startMessage = this._translateService.instant(startMessageResourceString, { operation: operation });

            this.setBusy();
            this.swapping = true;

            this._cacheService.postArm(params.uri, null, null, params.content)
                .mergeMap(r => {
                    if (params.operationType === 'slotsswap' && (!this.phase || this.phase === 'phaseTwo')) {
                        const location = r.headers.get('Location');
                        if (!location) {
                            return Observable.of({ success: false, error: 'no location header' });
                        } else {
                            return Observable.interval(1000)
                                .concatMap(_ => this._cacheService.get(location))
                                .map((r: Response) => r.status)
                                .take(30 * 60 * 1000)
                                .filter(s => s !== 202)
                                .map(r => { return { success: true, error: null } })
                                .catch(e => Observable.of({ success: false, error: e }))
                                .take(1);
                        }
                    } else {
                        return Observable.of({ success: true, error: null });
                    }
                })
                .catch(e => {
                    return Observable.of({ success: false, error: e })
                })
                .subscribe(r => {
                    this.dirtyMessage = null;
                    this.clearBusy();
                    this.swapping = false;

                    let resultMessage;

                    if (!r.success) {
                        this._logService.error(LogCategories.deploymentSlots, '/deployment-slots', r.error);

                        const failureResourceString = params.operationType === 'slotsswap' ? PortalResources.swapFailure : PortalResources.swapCancelFailure;
                        resultMessage = this._translateService.instant(failureResourceString, { operation: operation, error: JSON.stringify(r.error) });

                        // TODO [andimarc]: display error message in an error info box?
                    } else {
                        if (params.operationType === 'slotsswap') {
                            resultMessage = this._translateService.instant(PortalResources.swapSuccess, { operation: operation })

                            if (!this.phase || this.phase === 'phaseTwo') {
                                this.phase = 'complete';
                                this.successMessage = resultMessage;
                            } else {
                                this.phase = 'phaseTwo';
                                this.previewLink = params.previewLink;
                            }
                        } else {
                            resultMessage = this._translateService.instant(PortalResources.swapCancelSuccess, { operation: operation })
                            this.phase = 'phaseOne';
                        }

                        this._swappedOrCancelled = true;

                        // TODO [andimarc]: refresh the _slotsMap entries for the slot(s) involved in the swap
                    }
                });

        }
    }

    public _getOperationInputs(operationType: OperationType, phase: 'phaseOne' | 'phaseTwo'): SwapSlotParameters {
        const srcId = this.swapForm.controls['srcId'].value;
        const destId = this.swapForm.controls['destId'].value;
        const srcDescriptor: ArmSiteDescriptor = new ArmSiteDescriptor(srcId);
        const destDescriptor: ArmSiteDescriptor = new ArmSiteDescriptor(destId);

        const srcName = srcDescriptor.slot || 'production';
        const destName = destDescriptor.slot || 'production';
        const previewLink = 'https://' + (this._slotsMap[srcId] as SlotInfo).siteArm.properties.hostNames[0];
        const content = operationType === 'resetSlotConfig' ? null : { targetSlot: destName };


        let swapType = this._translateService.instant(PortalResources.swapFull);
        if (operationType === 'applySlotConfig') {
            swapType = this._translateService.instant(PortalResources.swapPhaseOne);
        } else if (operationType === 'slotsswap' && phase === 'phaseTwo') {
            swapType = this._translateService.instant(PortalResources.swapPhaseTwo);
        }


        return {
            operationType: operationType,
            uri: srcDescriptor.getTrimmedResourceId() + '/' + operationType,
            srcName: srcName,
            destName: destName,
            swapType: swapType,
            previewLink: previewLink,
            content: content
        };
    }

    private _submit(operationType: 'swap' | 'cancel') {
        this.dirtyMessage = this._translateService.instant(PortalResources.swapOperationInProgressWarning);

        if (!this.swapForm.pristine && this.swapForm.valid) { // TODO [andimarc]: check if form is valid
            if (this.swapForm.controls['multiPhase'].value && !this.phase) {
                this.phase = operationType === 'swap' ? 'phaseOne' : 'phaseTwo';
            }

            const srcId = this.swapForm.controls['srcId'].value;
            const destId = this.swapForm.controls['destId'].value;

            const srcDescriptor: ArmSiteDescriptor = new ArmSiteDescriptor(srcId);
            const destDescriptor: ArmSiteDescriptor = new ArmSiteDescriptor(destId);

            const srcName = srcDescriptor.slot || 'production';
            const destName = destDescriptor.slot || 'production';

            let path = srcDescriptor.getTrimmedResourceId();
            let content = null;
            let swapType = this._translateService.instant(PortalResources.swapFull);

            if (operationType === 'swap') {
                path += (this.phase === 'phaseOne' ? '/applyslotconfig' : '/slotsswap');

                content = { targetSlot: destName };

                if (this.phase === 'phaseOne') {
                    swapType = this._translateService.instant(PortalResources.swapPhaseOne);
                } else if (this.phase === 'phaseTwo') {
                    swapType = this._translateService.instant(PortalResources.swapPhaseTwo);
                }
            } else {
                path += '/resetSlotConfig';
            }

            const operation = this._translateService.instant(PortalResources.swapOperation, { swapType: swapType, srcSlot: srcName, destSlot: destName });

            //const startMessageResourceString = operationType === 'swap' ? PortalResources.swapStarted : PortalResources.swapCancelStarted;
            //const startMessage = this._translateService.instant(startMessageResourceString, { operation: operation });

            this.setBusy();
            this.swapping = true;

            this._cacheService.postArm(path, null, null, content)
                .mergeMap(r => {
                    if (operationType === 'swap' && (!this.phase || this.phase === 'phaseTwo')) {
                        const location = r.headers.get('Location');
                        if (!location) {
                            return Observable.of({ success: false, error: 'no location header' });
                        } else {
                            return Observable.interval(1000)
                                .concatMap(_ => this._cacheService.get(location))
                                .map((r: Response) => r.status)
                                .take(30 * 60 * 1000)
                                .filter(s => s !== 202)
                                .map(r => { return { success: true, error: null } })
                                .catch(e => Observable.of({ success: false, error: e }))
                                .take(1);
                        }
                    } else {
                        return Observable.of({ success: true, error: null });
                    }
                })
                .catch(e => {
                    return Observable.of({ success: false, error: e })
                })
                .subscribe(r => {
                    this.dirtyMessage = null;
                    this.clearBusy();
                    this.swapping = false;

                    let resultMessage;

                    if (!r.success) {
                        this._logService.error(LogCategories.deploymentSlots, '/deployment-slots', r.error);

                        const failureResourceString = operationType === 'swap' ? PortalResources.swapFailure : PortalResources.swapCancelFailure;
                        resultMessage = this._translateService.instant(failureResourceString, { operation: operation, error: JSON.stringify(r.error) });

                        // TODO [andimarc]: display error message in an error info box?

                    } else {
                        if (operationType === 'swap') {
                            resultMessage = this._translateService.instant(PortalResources.swapSuccess, { operation: operation })

                            if (!this.phase || this.phase === 'phaseTwo') {
                                this.phase = 'complete';
                                this.successMessage = resultMessage;
                            } else {
                                this.phase = 'phaseTwo';
                                this.previewLink = 'https://' + (this._slotsMap[srcId] as SlotInfo).siteArm.properties.hostNames[0];
                            }
                        } else {
                            resultMessage = this._translateService.instant(PortalResources.swapCancelSuccess, { operation: operation })
                            this.phase = 'phaseOne';
                        }

                        this._swappedOrCancelled = true;

                        // TODO [andimarc]: refresh the _slotsMap entries for the slot(s) involved in the swap
                    }
                });
        }
    }
}