import { TranslateService } from '@ngx-translate/core';
import { AuthzService } from 'app/shared/services/authz.service';
//import { PortalResources } from 'app/shared/models/portal-resources';
import { AsyncValidator, FormControl, FormGroup, ValidationErrors } from '@angular/forms';
import { Observable } from 'rxjs/Observable';
import { SiteService } from "app/shared/services/site.service";

export class SlotSwapSlotIdValidator implements AsyncValidator {
    constructor(
        private _formGroup: FormGroup,
        private _authZService: AuthzService,
        private _translateService: TranslateService,
        private _siteService: SiteService) { }

    /*
        private _clearError(controls: AbstractControl[], errorKey: string) {
            controls.forEach(ctrl => {
                if (ctrl.hasError(errorKey)) {
                    let errors: ValidationErrors = null;
                    for (let key in ctrl.errors) {
                        if (key !== errorKey) {
                            errors = errors || {};
                            errors[key] = ctrl.errors[key]
                        }
                    }
                    ctrl.setErrors(errors);
                }
            })
        }
    
        private _addError(controls: AbstractControl[], errorKey: string, errorValue: string) {
            controls.forEach(ctrl => {
                if (!ctrl.hasError(errorKey)) {
                    const errors: ValidationErrors = {};
                    errors[errorKey] = errorValue;
                    for (let key in ctrl.errors) {
                        errors[key] = ctrl.errors[key]
                    }
                    ctrl.setErrors(errors);
                }
            })
        }
    */

    validate(control: FormControl) {
        if (!this._formGroup) {
            throw 'FormGroup for validator cannot be null';
        }

        const srcIdCtrl: FormControl = this._formGroup.get('srcId') as FormControl;
        const srcAuthCtrl: FormControl = this._formGroup.get('srcAuth') as FormControl;
        const destIdCtrl: FormControl = this._formGroup.get('destId') as FormControl;
        const destAuthCtrl: FormControl = this._formGroup.get('destAuth') as FormControl;
        const multiPhaseCtrl: FormControl = this._formGroup.get('multiPhase') as FormControl;

        if (!srcIdCtrl || !srcAuthCtrl || !destIdCtrl || !destAuthCtrl || !multiPhaseCtrl) {
            throw 'Validator requires FormGroup with the following controls: srcId, srcAuth, destId, destAuth, multiPhase';
        }

        if (control === srcIdCtrl || control === destIdCtrl) {
            const authControl = control === srcIdCtrl ? srcAuthCtrl : destAuthCtrl;
            //const otherControl = control === srcIdCtrl ? destIdCtrl : srcIdCtrl;

            /*
            if (control.value && (control.value === otherControl.value)) {

                [control, otherControl].forEach(ctrl => {
                    if (!ctrl.hasError('notUnique')) {
                        const errors: ValidationErrors = { 'notUnique': this._translateService.instant('Source and Destination cannot be the same slot') };
                        for (let errorKey in ctrl.errors) {
                            errors[errorKey] = ctrl.errors[errorKey]
                        }
                        ctrl.setErrors(errors);
                    }
                })

            } else {

                [control, otherControl].forEach(ctrl => {
                    if (ctrl.hasError('notUnique')) {
                        let errors: ValidationErrors = null;
                        for (let errorKey in ctrl.errors) {
                            if (errorKey !== 'notUnique') {
                                errors = errors || {};
                                errors[errorKey] = ctrl.errors[errorKey]
                            }
                        }
                        ctrl.setErrors(errors);
                    }
                })

            }
            */

            /*
            if (control.value && (control.value === otherControl.value)) {
                this._addError([control, otherControl], 'notUnique', this._translateService.instant('Source and Destination cannot be the same slot'));
            } else {
                this._clearError([control, otherControl], 'notUnique');
            }
            */

            const resourceId: string = control.value as string;

            if (!resourceId) {
                return Promise.resolve(null);
            } else {
                return new Promise(resolve => {
                    Observable.zip(
                        this._authZService.hasPermission(resourceId, [AuthzService.writeScope]),
                        this._authZService.hasPermission(resourceId, [AuthzService.actionScope]),
                        this._authZService.hasReadOnlyLock(resourceId),
                        this._siteService.getSiteConfig(resourceId)
                    )
                        .subscribe(r => {
                            const hasWritePermission = r[0];
                            const hasSwapPermission = r[1];
                            const hasReadOnlyLock = r[2];
                            const siteConfigResult = r[3];

                            const siteAuthEnabled = siteConfigResult.isSuccessful ? siteConfigResult.result.properties.siteAuthEnabled : false;
                            authControl.setValue(siteAuthEnabled);

                            /*
                            if (siteAuthEnabled && multiPhaseCtrl.value) {
                                authControl.setErrors({ authMultiPhaseConflict: true });
                            } else {
                                authControl.setErrors(null);
                            }
                            */


                            if (hasSwapPermission && hasWritePermission && !hasReadOnlyLock) {
                                resolve(null);
                            } else {
                                const errors: ValidationErrors = {};
                                if (!hasSwapPermission) {
                                    errors['noSwapPermission'] = this._translateService.instant('No swap permission for slot');
                                }
                                if (!hasWritePermission) {
                                    errors['noWritePermission'] = this._translateService.instant('No write permission for slot');
                                }
                                if (hasReadOnlyLock) {
                                    errors['readOnlyLock'] = this._translateService.instant('Read-only lock on slot');
                                }

                                resolve(errors);
                            }
                        })
                });
            }

        } else {
            throw 'FormGroup for validator must be parent of FormControl being validated';
        }
    }
}