import { LogCategories, ScenarioIds, SiteTabIds } from 'app/shared/models/constants';
import { LogService } from 'app/shared/services/log.service';
import { Component, Injector, Input, OnDestroy, Output } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { FormBuilder, FormGroup } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { ArmObj, ResourceId } from 'app/shared/models/arm/arm-obj';
import { Site } from 'app/shared/models/arm/site';
import { RequiredValidator } from 'app/shared/validators/requiredValidator';
import { PortalResources } from 'app/shared/models/portal-resources';
import { SlotNameValidator } from 'app/shared/validators/slotNameValidator';
import { AuthzService } from 'app/shared/services/authz.service';
import { FeatureComponent } from 'app/shared/components/feature-component';
import { ArmSiteDescriptor } from 'app/shared/resourceDescriptors';
import { SiteService } from 'app/shared/services/site.service';
import { SiteConfig } from 'app/shared/models/arm/site-config';
import { DropDownElement } from 'app/shared/models/drop-down-element';
import { ScenarioService } from 'app/shared/services/scenario/scenario.service';
import { CloneSrcValidator } from "app/site/deployment-slots/add-slot/cloneSrcValidator";

// TODO [andimarc]: disable all controls when an add operation is in progress

export interface AddSlotParameters {
    siteId: ResourceId,
    newSlotName: string,
    location: string,
    serverFarmId: string,
    cloneConfig?: SiteConfig
}

@Component({
    selector: 'add-slot',
    templateUrl: './add-slot.component.html',
    styleUrls: ['./add-slot.component.scss', './../common.scss']
})
export class AddSlotComponent extends FeatureComponent<ResourceId> implements OnDestroy {
    @Input() set resourceId(resourceId: ResourceId) {
        this.setInput(resourceId);
    }

    @Output() parameters: Subject<AddSlotParameters>;


    public dirtyMessage: string;

    public Resources = PortalResources;
    public addForm: FormGroup;
    public hasCreateAcess: boolean;
    public slotsQuotaMessage: string;
    public isLoading = true;
    public loadingFailed = false;
    public cloneSrcIdDropDownOptions: DropDownElement<string>[];

    private _slotConfig: SiteConfig;
    private _siteId: string;
    private _slotsArm: ArmObj<Site>[];

    constructor(
        private _fb: FormBuilder,
        private _siteService: SiteService,
        private _translateService: TranslateService,
        private _logService: LogService,
        private _authZService: AuthzService,
        private _scenarioService: ScenarioService,
        private _injector: Injector
    ) {
        super('AddSlotComponent', _injector, SiteTabIds.deploymentSlotsConfig);

        // TODO [andimarc]
        // For ibiza scenarios, this needs to match the deep link feature name used to load this in ibiza menu
        this.featureName = 'deploymentslots';
        this.isParentComponent = true;

        this.parameters = new Subject<AddSlotParameters>();

        const nameCtrl = this._fb.control({ value: null, disabled: true });
        const cloneSrcIdCtrl = this._fb.control({ value: null, disabled: true });
        const cloneSrcConfigCtrl = this._fb.control({ value: null, disabled: true });

        this.addForm = this._fb.group({
            name: nameCtrl,
            cloneSrcId: cloneSrcIdCtrl,
            cloneSrcConfig: cloneSrcConfigCtrl
        });
    }

    protected setup(inputEvents: Observable<ResourceId>) {
        return inputEvents
            .distinctUntilChanged()
            .switchMap(resourceId => {
                this.hasCreateAcess = false;
                this.slotsQuotaMessage = null;
                this.isLoading = true;
                this.loadingFailed = false;

                this.cloneSrcIdDropDownOptions = null;

                this._slotConfig = null;
                this._slotsArm = null;

                const siteDescriptor = new ArmSiteDescriptor(resourceId);
                this._siteId = siteDescriptor.getSiteOnlyResourceId();

                return Observable.zip(
                    this._siteService.getSite(this._siteId),
                    this._siteService.getSlots(this._siteId),
                    this._authZService.hasPermission(this._siteId, [AuthzService.writeScope]),
                    this._authZService.hasReadOnlyLock(this._siteId));
            })
            .mergeMap(r => {
                const siteResult = r[0];
                const slotsResult = r[1];
                const hasWritePermission = r[2];
                const hasReadOnlyLock = r[3];

                this.hasCreateAcess = hasWritePermission && !hasReadOnlyLock;

                if (!siteResult.isSuccessful) {
                    this._logService.error(LogCategories.addSlot, '/add-slot', siteResult.error.result);
                    this.loadingFailed = true;
                }
                if (!slotsResult.isSuccessful) {
                    this._logService.error(LogCategories.addSlot, '/add-slot', slotsResult.error.result);
                    this.loadingFailed = true;
                }

                if (!this.loadingFailed) {
                    this._slotsArm = slotsResult.result.value;
                    this._slotsArm.unshift(siteResult.result);
                    return this._scenarioService.checkScenarioAsync(ScenarioIds.getSiteSlotLimits, { site: siteResult.result });
                } else {
                    return Observable.of(null);
                }
            })
            .do(r => {
                if (r && r.status === 'enabled') {
                    const slotsQuota = r.data;

                    if (this._slotsArm && this._slotsArm.length >= slotsQuota) {
                        this.slotsQuotaMessage = this._translateService.instant(PortalResources.slotNew_quotaReached, { quota: slotsQuota });
                    }
                }

                this._setupForm();
                this.isLoading = false;
            });
    }

    private _setupForm() {
        const nameCtrl = this.addForm.get('name');
        const cloneSrcIdCtrl = this.addForm.get('cloneSrcId')
        const cloneSrcConfigCtrl = this.addForm.get('cloneSrcConfig')

        if (!this.hasCreateAcess || !!this.slotsQuotaMessage || this.loadingFailed) {

            nameCtrl.clearValidators();
            nameCtrl.clearAsyncValidators();
            nameCtrl.setValue(null);
            nameCtrl.disable();

            cloneSrcIdCtrl.clearValidators();
            cloneSrcIdCtrl.clearAsyncValidators();
            cloneSrcIdCtrl.setValue(null);
            cloneSrcIdCtrl.disable();

            cloneSrcConfigCtrl.clearValidators();
            cloneSrcConfigCtrl.clearAsyncValidators();
            cloneSrcConfigCtrl.setValue(null);
            cloneSrcConfigCtrl.disable();

        } else {

            const requiredValidator = new RequiredValidator(this._translateService);
            const slotNameValidator = new SlotNameValidator(this._injector, this._siteId);
            nameCtrl.enable();
            nameCtrl.setValue(null);
            nameCtrl.setValidators(requiredValidator.validate.bind(requiredValidator));
            nameCtrl.setAsyncValidators(slotNameValidator.validate.bind(slotNameValidator));

            const options: DropDownElement<string>[] = [
                {
                    displayLabel: this._translateService.instant(PortalResources.slotNew_dontCloneConfig),
                    value: '-'
                }
            ];
            this._slotsArm.forEach(s => {
                options.push({
                    displayLabel: s.properties.name,
                    value: s.id
                });
            })
            this.cloneSrcIdDropDownOptions = options;

            const cloneSrcValidator = new CloneSrcValidator(this._siteService, this._translateService, this.addForm);
            cloneSrcIdCtrl.enable();
            cloneSrcIdCtrl.setValue('-');
            cloneSrcIdCtrl.setAsyncValidators(cloneSrcValidator.validate.bind(cloneSrcValidator));

            cloneSrcConfigCtrl.enable();
            cloneSrcConfigCtrl.setValue(null);
        }
    }

    submit() {
        const newSlotName = this.addForm.controls['name'].value;
        const newSlotConfig = this.addForm.controls['cloneSrcConfig'].value;

        this.parameters.next({
            siteId: this._slotsArm[0].id,
            newSlotName: newSlotName,
            location: this._slotsArm[0].location,
            serverFarmId: this._slotsArm[0].properties.serverFarmId,
            cloneConfig: newSlotConfig
        });
    }

    cancel() {
        const confirmMsg = this._translateService.instant(PortalResources.unsavedChangesWarning);
        const close = (!this.addForm || !this.addForm.dirty) ? true : confirm(confirmMsg);

        if (close) {
            this.parameters.next(null);
        }
    }
}