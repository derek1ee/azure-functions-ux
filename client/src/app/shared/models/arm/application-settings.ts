export interface ApplicationSettings {
    [key: string]: string;
}

export type ApplicationSettingPropertyBag = ApplicationSettingInfo[];

export interface ApplicationSettingInfo {
    name: string;
    value: string;
}