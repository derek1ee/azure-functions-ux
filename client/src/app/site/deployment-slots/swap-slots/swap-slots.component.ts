import { Component, Injector, Input, OnDestroy, Output } from '@angular/core';
//import { Response } from '@angular/http';
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
import { SlotSwapGroupValidator } from "app/site/deployment-slots/swap-slots/slotSwapGroupValidator";
import { SlotSwapSlotIdValidator } from "app/site/deployment-slots/swap-slots/SlotSwapSlotIdValidator";

// TODO [andimarc]: disable all controls when a swap operation is in progress
// TODO [andimarc]: disable controls when in phaseTwo or complete

export type OperationType = 'slotsswap' | 'applySlotConfig' | 'resetSlotConfig';

export type SwapStep = 'loading' | 'phase1' | 'phase1-executing' | 'phase2-loading' | 'phase2';

export interface SwapSlotParameters {
    operationType: OperationType,
    uri: string,
    srcName: string,
    destName: string,
    swapType: string,
    content?: any
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

    public currentStep: SwapStep;
    public currentStepFailure: string;

    public swapPermissionsMessage: string;
    public writePermissionsMessage: string;
    public readOnlyLockMessage: string;

    public srcDestEditable: boolean;

    public progressMessage: string;

    public showActionDropdown: boolean;
    public actionDropDownOptions: DropDownElement<boolean>[];

    public Resources = PortalResources;
    public srcDropDownOptions: DropDownElement<string>[];
    public destDropDownOptions: DropDownElement<string>[];
    public siteResourceId: ResourceId;
    public siteName: string;

    public noStickySettings = false;

    public showPreviewLink: boolean;
    public previewLink: string;

    //public phase: null | 'phaseOne' | 'phaseTwo' | 'complete';

    //public checkingSrc: boolean;
    //public checkingDest: boolean;
    public loadingDiffs: boolean;
    public swapping: boolean;

    public showPreviewChanges: boolean;
    public slotsDiffs: SlotsDiff[];
    public diffsPreviewSlot: 'source' | 'target' = 'source';

    public swapForm: FormGroup;

    private _slotsList: ArmObj<Site>[];

    private _swappedOrCancelled: boolean;

    private _diffSubject: Subject<string>;

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

        this._diffSubject = new Subject<string>();
        this._diffSubject
            .takeUntil(this.ngUnsubscribe)
            .distinctUntilChanged()
            .switchMap(slotsString => {
                if (slotsString) {
                    const slots = slotsString.split(',');
                    if (slots.length === 2) {
                        this.loadingDiffs = true;
                        return this._getSlotsDiffs(slots[0], slots[1]);
                    }
                }
                return Observable.of(null);
            })
            .subscribe(r => {
                this.loadingDiffs = false;
                this.slotsDiffs = !r ? null : r.value.map(o => o.properties);
            });

        this._setupSwapForm();

        this.actionDropDownOptions = [
            {
                displayLabel: this._translateService.instant('Complete Swap'), //TODO andimarc: use Resources
                value: false,
                default: true
            },
            {
                displayLabel: this._translateService.instant('Revert'), //TODO andimarc: use Resources
                value: true,
                default: false
            }
        ]
    }

    protected setup(inputEvents: Observable<ResourceId>) {
        return inputEvents
            .distinctUntilChanged()
            .switchMap(resourceId => {
                this._resourceId = resourceId;

                this.dirtyMessage = null;

                this.currentStep = 'loading';
                this.currentStepFailure = null;

                this.swapPermissionsMessage = null;
                this.writePermissionsMessage = null;
                this.readOnlyLockMessage = null;

                this.srcDestEditable = true;

                this.progressMessage = null;

                this.showActionDropdown = false;

                this.noStickySettings = false;

                this.showPreviewChanges = false;

                this.loadingDiffs = false;
                this.swapping = false;

                this.showPreviewLink = false;
                this.previewLink = null;

                this.srcDropDownOptions = [];
                this.destDropDownOptions = [];

                this._swappedOrCancelled = false;

                this._setupSwapForm();

                const siteDescriptor = new ArmSiteDescriptor(resourceId);
                this.siteResourceId = siteDescriptor.getSiteOnlyResourceId();
                this.siteName = siteDescriptor.site;

                return Observable.zip(
                    this._siteService.getSite(this.siteResourceId),
                    this._siteService.getSlots(this.siteResourceId),
                    this._siteService.getSlotConfigNames(this.siteResourceId)
                );
            })
            .switchMap(r => {
                const siteResult = r[0];
                const slotsResult = r[1];
                const slotConfigNamesResult = r[2];

                let loadingFailed = false;
                if (!siteResult.isSuccessful) {
                    this._logService.error(LogCategories.swapSlots, '/swap-slots', siteResult.error.result);
                    loadingFailed = true;
                }
                if (!slotsResult.isSuccessful) {
                    this._logService.error(LogCategories.swapSlots, '/swap-slots', slotsResult.error.result);
                    loadingFailed = true;
                }
                if (!slotConfigNamesResult.isSuccessful) {
                    this._logService.error(LogCategories.swapSlots, '/swap-slots', slotConfigNamesResult.error.result);
                    //loadingFailed = true;
                } else {
                    const appSettingNames = slotConfigNamesResult.result.properties.appSettingNames || [];
                    const connectionStringNames = slotConfigNamesResult.result.properties.connectionStringNames || [];
                    this.noStickySettings = appSettingNames.length === 0 && connectionStringNames.length === 0;
                }

                if (loadingFailed) {
                    this.currentStepFailure = 'Failed to load'; //TODO andimarc
                    return Observable.of(null);
                } else if (!slotsResult.result.value || slotsResult.result.value.length === 0) {
                    this.currentStepFailure = 'Swap can only be performed if app has multiple slots'; //TODO andimarc
                    return Observable.of(null);
                } else {

                    this._slotsList = [siteResult.result, ...slotsResult.result.value];
                    //let srcSlot: ArmObj<Site> = null;
                    let srcId: string = this._resourceId;
                    let destId: string = null;

                    const options: DropDownElement<string>[] = [];
                    this._slotsList.forEach(slot => {
                        options.push({
                            displayLabel: slot.properties.name,
                            value: slot.id
                        });
                        //srcSlot = (!srcSlot && slot.id === srcId) ? slot : srcSlot;
                        destId = (!destId && slot.id !== srcId) ? slot.id : destId;
                    })

                    this.srcDropDownOptions = JSON.parse(JSON.stringify(options));
                    this.destDropDownOptions = JSON.parse(JSON.stringify(options));

                    const srcSlot = this._getSlotArm(srcId);
                    const targetSwapSlot = srcSlot ? srcSlot.properties.targetSwapSlot : null;

                    if (!targetSwapSlot) {
                        // We're in Phase1
                        this._setupPhase1(srcId, destId);
                        return Observable.of(null);
                    } else {
                        // We're already in Phase2
                        this._setupPhase2Loading(srcId, targetSwapSlot);
                        return Observable.zip(
                            this._authZService.hasPermission(srcId, [AuthzService.writeScope]),
                            this._authZService.hasPermission(destId, [AuthzService.writeScope]),
                            this._authZService.hasPermission(srcId, [AuthzService.actionScope]),
                            this._authZService.hasPermission(destId, [AuthzService.actionScope]),
                            this._authZService.hasReadOnlyLock(srcId),
                            this._authZService.hasReadOnlyLock(destId),
                            Observable.of(srcId),
                            Observable.of(destId)
                        );
                    }
                }
            })
            .do(result => {
                if (!result) {
                    // loading failed, or phase1 has been loaded
                }
                else {
                    const srcId = result[6];
                    const destId = result[7];

                    const srcDescriptor = new ArmSiteDescriptor(srcId);
                    const destDescriptor = new ArmSiteDescriptor(destId);
                    const srcName = srcDescriptor.slot || 'production';
                    const destName = destDescriptor.slot || 'production';

                    const srcWritePermission = result[0];
                    const destWritePermission = result[1];
                    const slotsMissingWritePermission = [
                        srcWritePermission ? null : srcName,
                        destWritePermission ? null : destName
                    ].filter(r => { return !!r });

                    const srcSwapPermission = result[2];
                    const destSwapPermission = result[3];
                    const slotsMissingSwapPermission = [
                        srcSwapPermission ? null : srcName,
                        destSwapPermission ? null : destName
                    ].filter(r => { return !!r });


                    const srcReadOnlyLock = result[4];
                    const destReadOnlyLock = result[5];
                    const slotsWithReadOnlyLock = [
                        !srcReadOnlyLock ? null : srcName,
                        destReadOnlyLock ? null : destName
                    ].filter(r => { return !!r });

                    let failed = false;
                    if (slotsMissingWritePermission.length > 0) {
                        const slotNames = slotsMissingWritePermission.join(', ');
                        this.writePermissionsMessage = this._translateService.instant('You do not have write permission on the following slots: \'{0}\'', { slotNames: slotNames });
                        failed = true;
                    }
                    if (slotsMissingSwapPermission.length > 0) {
                        const slotNames = slotsMissingSwapPermission.join(', ');
                        this.swapPermissionsMessage = this._translateService.instant('You do not have swap permission on the following slots: \'{0}\'', { slotNames: slotNames });
                        failed = true;
                    }
                    if (slotsWithReadOnlyLock.length > 0) {
                        const slotNames = slotsWithReadOnlyLock.join(', ');
                        this.readOnlyLockMessage = this._translateService.instant('There is a read-only lock on the following slots: \'{0}\'', { slotNames: slotNames });
                        failed = true;
                    }

                    if (!failed) {
                        this._setupPhase2();
                    }
                }

                //this.isLoading = false;
            });
    }

    private _setupSwapForm() {
        const srcIdCtrl = this._fb.control({ value: null, disabled: true });
        const srcAuthCtrl = this._fb.control({ value: null, disabled: true });

        const destIdCtrl = this._fb.control({ value: null, disabled: true });
        const desConfigCtrl = this._fb.control({ value: null, disabled: true });

        const multiPhaseCtrl = this._fb.control({ value: false, disabled: true });

        const revertSwapCtrl = this._fb.control({ value: false, disabled: true });

        this.swapForm = this._fb.group({
            srcId: srcIdCtrl,
            srcAuth: srcAuthCtrl,
            destId: destIdCtrl,
            desConfig: desConfigCtrl,
            multiPhase: multiPhaseCtrl,
            revertSwap: revertSwapCtrl,
        });
    }

    private _getSlotArm(slotId: ResourceId): ArmObj<Site> {
        let slotArm: ArmObj<Site> = null;

        if (this._slotsList) {
            const index = this._slotsList.findIndex(s => s.id === slotId);
            if (index !== -1) {
                slotArm = this._slotsList[index];
            }
        }

        return slotArm;
    }

    private _getPreviewLink(slotId: ResourceId): string {
        const slotArm = this._getSlotArm(slotId);
        return slotArm ? `https://${slotArm.properties.hostNames[0]}` : null;
    }

    private _setupPhase1(srcId: ResourceId, destId: ResourceId) {
        this.currentStep = 'phase1';

        this.srcDropDownOptions.forEach(o => o.default = o.value === srcId);
        this.destDropDownOptions.forEach(o => o.default = o.value === destId);

        this.swapForm.controls['srcId'].enable();
        this.swapForm.controls['srcAuth'].enable();
        this.swapForm.controls['destId'].enable();
        this.swapForm.controls['destAuth'].enable();
        if (!this.noStickySettings) {
            this.swapForm.controls['multiPhase'].enable();
        }


        const slotSwapGroupValidator = new SlotSwapGroupValidator(this._translateService);
        this.swapForm.setValidators(slotSwapGroupValidator.validate.bind(slotSwapGroupValidator));

        const slotSwapSlotIdValidator = new SlotSwapSlotIdValidator(this.swapForm, this._authZService, this._translateService, this._siteService);
        this.swapForm.controls['srcId'].setAsyncValidators(slotSwapSlotIdValidator.validate.bind(slotSwapSlotIdValidator));
        this.swapForm.controls['destId'].setAsyncValidators(slotSwapSlotIdValidator.validate.bind(slotSwapSlotIdValidator));

        this.swapForm.controls['srcId'].setValue(srcId);
        this.swapForm.controls['destId'].setValue(destId);
        this._diffSubject.next(`${srcId},${destId}`); //WHEN DO WE SET UP THE SUBSCRIPTION ON _diffSubject?

        //UPDATE PHASE TRACKER CLASS
        this.showPreviewChanges = true;
        //ENABLE SWAP BUTTON

        /*
        ['srcId', 'srcAuth', 'destId', 'destAuth', 'multiPhase', 'revertSwap'].forEach(name => {
            const ctrl = this.swapForm.get(name);
            ctrl.clearValidators();
            ctrl.clearAsyncValidators();
            ctrl.setValue(null);
            ctrl.disable();
        });
        */
    }

    private _setupPhase1Executing() {
        this.currentStep = 'phase1-executing';
        this.showPreviewChanges = false;
    }

    private _setupPhase2Loading(srcId: ResourceId, targetSwapSlot: string) {
        this.currentStep = 'phase2-loading';
        const destId = targetSwapSlot.toLowerCase() === 'production' ?
            this.siteResourceId :
            this.siteResourceId + '/slots/' + targetSwapSlot.toLowerCase();

        //TODO andimarc: Make sure dest slot has targetSwapSlot set and that this value matches src slot(?)

        this.swapForm.controls['srcId'].setValue(srcId);
        this.swapForm.controls['destId'].setValue(destId);
        this.srcDestEditable = false;
        this.swapForm.controls['multiPhase'].setValue(true);
        //UPDATE PHASE TRACKER CLASS
        this.previewLink = this._getPreviewLink(srcId);
        this.showPreviewLink = true;
        this.showActionDropdown = true;
        //HIDE SWAP BUTTON
        //SHOW ACTION BUTTON (disabled)
    }

    private _setupPhase2() {
        const prevStep = this.currentStep;
        this.currentStep = 'phase2';

        if (prevStep === 'phase2-loading') {

        } else if (prevStep === 'phase1-executing') {
            //UPDATE PHASE TRACKER CLASS
            this.previewLink = this._getPreviewLink(this.swapForm.controls['srcId'].value);
            this.showPreviewLink = true;
            this.showActionDropdown = true;
            //HIDE SWAP BUTTON
            //SHOW ACTION BUTTON
        }

        //ENABLE ACTION BUTTON
    }

    cancel() {
        let confirmMsg = null;

        //TODO andimarc: expand this to full list of conditions
        if (this.swapForm && this.swapForm.dirty) {
            confirmMsg = this._translateService.instant(PortalResources.unsavedChangesWarning);
        }

        const close = confirmMsg ? confirm(confirmMsg) : true;
        if (close) {
            this.close.next(null);
        }
    }

    swap() {
        const params = this._getOperationInputs('slotsswap');
        this.close.next(params);
    }

    cancelMultiPhaseSwap() {
        //UPDATE PHASE TRACKER CLASS
        setTimeout(_ => {
            const params = this._getOperationInputs('resetSlotConfig');
            this.close.next(params);
        }, 500);
    }

    completeMultiPhaseSwap() {
        //UPDATE PHASE TRACKER CLASS
        setTimeout(_ => {
            const params = this._getOperationInputs('slotsswap');
            this.close.next(params);
        }, 500);
    }

    applySlotConfig(params: SwapSlotParameters) {

        //const operation = this._translateService.instant(PortalResources.swapOperation, { swapType: params.swapType, srcSlot: params.srcName, destSlot: params.destName });
        //const startMessage = this._translateService.instant(PortalResources.swapStarted, { operation: operation });

        this._setupPhase1Executing();
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

                //let resultMessage = r.success ?
                //  this._translateService.instant(PortalResources.swapSuccess, { operation: operation }) :
                //  this._translateService.instant(PortalResources.swapFailure, { operation: operation, error: JSON.stringify(r.error) })

                if (!r.success) {
                    this._logService.error(LogCategories.deploymentSlots, '/deployment-slots', r.error);
                    // TODO [andimarc]: display error message in an error info box?

                } else {
                    this._setupPhase2();
                    this._swappedOrCancelled = true;
                }
                // TODO [andimarc]: refresh the _slotsList entries for the slot(s) involved in the swap
            });
    }

    private _getOperationInputs(operationType: OperationType): SwapSlotParameters {
        const multiPhase = this.swapForm.controls['srcId'].value;
        const srcId = this.swapForm.controls['srcId'].value;
        const destId = this.swapForm.controls['destId'].value;
        const srcDescriptor: ArmSiteDescriptor = new ArmSiteDescriptor(srcId);
        const destDescriptor: ArmSiteDescriptor = new ArmSiteDescriptor(destId);

        const srcName = srcDescriptor.slot || 'production';
        const destName = destDescriptor.slot || 'production';
        const content = operationType === 'resetSlotConfig' ? null : { targetSlot: destName };


        let swapType = this._translateService.instant(PortalResources.swapFull);
        if (operationType === 'applySlotConfig') {
            swapType = this._translateService.instant(PortalResources.swapPhaseOne);
        } else if (operationType === 'slotsswap' && multiPhase) {
            swapType = this._translateService.instant(PortalResources.swapPhaseTwo);
        }


        return {
            operationType: operationType,
            uri: srcDescriptor.getTrimmedResourceId() + '/' + operationType,
            srcName: srcName,
            destName: destName,
            swapType: swapType,
            content: content
        };
    }

    /*
    private _resetForm() {
        const srcIdCtrl = this.swapForm.get('srcId');
        const srcAuthCtrl = this.swapForm.get('srcAuth');
        const destIdCtrl = this.swapForm.get('destId');
        const destAuthCtrl = this.swapForm.get('destAuth');
        const multiPhaseCtrl = this.swapForm.get('multiPhase');
        const revertSwapCtrl = this.swapForm.get('revertSwap');

        [srcIdCtrl, srcAuthCtrl, destIdCtrl, destAuthCtrl, multiPhaseCtrl, revertSwapCtrl].forEach(ctrl => {
            ctrl.clearValidators();
            ctrl.clearAsyncValidators();
            ctrl.setValue(null);
            ctrl.disable();
        });
    }

    private _setupForm() {
        const srcIdCtrl = this.swapForm.get('srcId');
        const srcAuthCtrl = this.swapForm.get('srcAuth');
        const destIdCtrl = this.swapForm.get('destId');
        const destAuthCtrl = this.swapForm.get('destAuth');
        const multiPhaseCtrl = this.swapForm.get('multiPhase');
        const revertSwapCtrl = this.swapForm.get('revertSwap');

        srcIdCtrl.enable();
        //setup validators

        srcAuthCtrl.enable();

        destIdCtrl.enable();
        //setup validators

        destAuthCtrl.enable();

        if (!this.noStickySettings) {
            multiPhaseCtrl.enable();
            //setup validators
        }

        revertSwapCtrl.enable();
    }
    */

    /*
    private _validateAndDiff() {
        // TODO [andimarc]: user form validation instaed

        const src = this.swapForm ? this.swapForm.controls['srcId'].value : null;
        const dest = this.swapForm ? this.swapForm.controls['destId'].value : null;
        const multiPhase = this.swapForm ? this.swapForm.controls['multiPhase'].value : false;

        // this.slotsNotUnique = src === dest;
        // this.srcNotSelected = !src;
        // this.destNotSelected = !dest;
        // this.srcNoSwapAccess = !!src && this._slotsMap[src] && !this._slotsMap[src].hasSwapAccess;
        // this.destNoSwapAccess = !!dest && this._slotsMap[dest] && !this._slotsMap[dest].hasSwapAccess;

        const siteAuthConflicts: string[] = [];
        if (multiPhase) {
            [src, dest].forEach(r => {
                if (!!r && this._slotsMap[r] && this._slotsMap[r].hasSiteAuth) {
                    siteAuthConflicts.push(r);
                }
            })

        }

        // this.siteAuthConflicts = siteAuthConflicts.length === 0 ? null : siteAuthConflicts;

        // // TODO [andimarc]: make sure neither src or dest slot have targetSwapSlot set (unless this is phase two of a swap and the value match up)

        // this.isValid = !this.slotsNotUnique
        //     && !this.srcNotSelected
        //     && !this.destNotSelected
        //     && !this.srcNoSwapAccess
        //     && !this.destNoSwapAccess
        //     && !this.siteAuthConflicts;

        // if (this.isValid) {
        //     this._diffSubject.next(`${src},${dest}`);
        // }
    }
    */

    /*
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
    */

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

    /*
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

                
                //let resultMessage = r.success ?
                //    this._translateService.instant(PortalResources.swapSuccess, { operation: operation }) :
                //    this._translateService.instant(PortalResources.swapFailure, { operation: operation, error: JSON.stringify(r.error) });

                if (!r.success) {
                    this._logService.error(LogCategories.deploymentSlots, '/deployment-slots', r.error);
                    // TODO [andimarc]: display error message in an error info box?
                } else {
                    this._swappedOrCancelled = true;
                }
                // TODO [andimarc]: refresh the _slotsMap entries for the slot(s) involved in the swap
            });
    }
    */

    /*
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

                //let resultMessage = r.success ?
                //  this._translateService.instant(PortalResources.swapCancelSuccess, { operation: operation }) :
                //  this._translateService.instant(PortalResources.swapCancelFailure, { operation: operation, error: JSON.stringify(r.error) });

                if (!r.success) {
                    this._logService.error(LogCategories.deploymentSlots, '/deployment-slots', r.error);
                    // TODO [andimarc]: display error message in an error info box?
                } else {
                    this._swappedOrCancelled = true;
                }
                // TODO [andimarc]: refresh the _slotsMap entries for the slot(s) involved in the swap
            });
    }
    */

    /*
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
    */

    /*
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
    */
}