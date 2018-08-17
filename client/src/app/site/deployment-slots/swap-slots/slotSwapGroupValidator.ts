import { FormControl, FormGroup, Validator, ValidationErrors } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { ArmSiteDescriptor } from "app/shared/resourceDescriptors";
//import { PortalResources } from 'app/shared/models/portal-resources';


export class SlotSwapGroupValidator implements Validator {
    constructor(private _translateService: TranslateService) { }

    validate(group: FormGroup) {
        let errors: ValidationErrors = null;

        const srcIdCtrl: FormControl = group.get('srcId') as FormControl;
        const srcAuthCtrl: FormControl = group.get('srcAuth') as FormControl;
        const destIdCtrl: FormControl = group.get('destId') as FormControl;
        const destAuthCtrl: FormControl = group.get('destAuth') as FormControl;
        const multiPhaseCtrl: FormControl = group.get('multiPhase') as FormControl;

        if (!srcIdCtrl || !srcAuthCtrl || !destIdCtrl || !destAuthCtrl || !multiPhaseCtrl) {
            throw 'Validator requires FormGroup with the following controls: srcId, srcAuth, destId, destAuth, multiPhase';
        }

        if (srcIdCtrl.value === destIdCtrl.value) {
            errors = errors || {};
            errors['notUnique'] = this._translateService.instant('Source and Destination cannot be the same slot');
        }

        if (multiPhaseCtrl.value) {
            const authEnabledSlotNames = [];

            if (srcAuthCtrl.value) {
                const srcDescriptor = new ArmSiteDescriptor(srcIdCtrl.value);
                authEnabledSlotNames.push(srcDescriptor.slot || 'production')
            }

            if (destAuthCtrl.value) {
                const destDescriptor = new ArmSiteDescriptor(destIdCtrl.value);
                authEnabledSlotNames.push(destDescriptor.slot || 'production')
            }

            if (authEnabledSlotNames.length > 0) {
                const slotNames = authEnabledSlotNames.join(', ');
                errors['authMultiPhaseConflict'] = this._translateService.instant('Multi-phase swap cannot be used because the following slots have authentication enabled: \'{0}\'', { slotNames: slotNames });
            }
        }

        return errors;
    }
}
