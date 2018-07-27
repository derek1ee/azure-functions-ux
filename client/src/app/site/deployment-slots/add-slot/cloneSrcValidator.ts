import { AsyncValidator, FormControl, FormGroup } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs/Observable';
import { SiteService } from 'app/shared/services/site.service';
import { CustomFormControl } from "app/controls/click-to-edit/click-to-edit.component";

export class CloneSrcValidator implements AsyncValidator {
    constructor(
        private _siteService: SiteService,
        private _translateService: TranslateService,
        private _formGroup: FormGroup) { }

    validate(control: FormControl) {
        if (!this._formGroup) {
            throw "FormGroup for validator cannot be null";
        }

        const nameCtrl: FormControl = this._formGroup.get('name') as FormControl;
        const cloneSrcIdCrtl: FormControl = this._formGroup.get('cloneSrcId') as FormControl;
        const cloneSrcConfigCtrl: FormControl = this._formGroup.get('cloneSrcConfig') as FormControl;

        if (!nameCtrl || !cloneSrcIdCrtl || !cloneSrcConfigCtrl) {
            throw "Validator requires FormGroup with controls 'name' 'cloneSrcId' and 'cloneSrcConfig'";
        }

        if (control !== cloneSrcIdCrtl) {
            throw "FormGroup for validator must be parent of FormControl being validated";
        }  

        if (!(nameCtrl as CustomFormControl)._msRunValidation) {
            (nameCtrl as CustomFormControl)._msRunValidation = true;

            if (nameCtrl.pristine) {
                nameCtrl.updateValueAndValidity();
            }
        }

        cloneSrcConfigCtrl.setValue(null);

        const cloneSrcId = cloneSrcIdCrtl.value;

        if (!cloneSrcId) {
            return Promise.resolve({
                valueError: this._translateService.instant("Value cannot be null") // TODO [andimarc]: use Resource string
            });
        } else if (cloneSrcId === '-') {
            return Promise.resolve(null);
        } else {
            return new Promise(resolve => {
                Observable.zip(
                    this._siteService.getSiteConfig(cloneSrcId),
                    this._siteService.getAppSettings(cloneSrcId),
                    this._siteService.getConnectionStrings(cloneSrcId)
                ).subscribe(r => {
                    const siteConfigResult = r[0];
                    const appSettingsResult = r[1];
                    const connectionStringsResult = r[2];

                    if (siteConfigResult.isSuccessful && appSettingsResult.isSuccessful && connectionStringsResult.isSuccessful) {
                        const cloneSrcConfig = siteConfigResult.result.properties;
                        cloneSrcConfig.appSettings = [];
                        for (let key in appSettingsResult.result.properties) {
                            cloneSrcConfig.appSettings.push({
                                name: key,
                                value: appSettingsResult.result.properties[key]
                            });
                        };
                        cloneSrcConfig.connectionStrings = [];
                        for (let key in connectionStringsResult.result.properties) {
                            cloneSrcConfig.connectionStrings.push({
                                name: key,
                                connectionString: connectionStringsResult.result.properties[key].value,
                                type: connectionStringsResult.result.properties[key].type
                            });
                        };
                        cloneSrcConfigCtrl.setValue(cloneSrcConfig);
                        resolve(null);
                    } else {
                        resolve({
                            configReadError: this._translateService.instant("Failed to retrieve source config") // TODO [andimarc]: Use Resource string. Include reason.
                        });
                    }
                });
            });
        }
    }
}
