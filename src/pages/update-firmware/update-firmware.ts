import { Component, ViewChild } from '@angular/core';
import { NavParams, Slides, ViewController, LoadingController } from 'ionic-angular';

//Components
import { ProgressBarComponent } from '../../components/progress-bar/progress-bar.component';

//Services
import { StorageService } from '../../services/storage/storage.service';
import { SettingsService } from '../../services/settings/settings.service';
import { DeviceManagerService } from '../../services/device/device-manager.service';

//Interfaaces
import { DeviceCardInfo } from '../device-manager-page/device-manager-page.interface';

@Component({
    templateUrl: 'update-firmware.html',
})
export class UpdateFirmwarePage {
    @ViewChild('updateFirmwareSlider') slider: Slides;
    @ViewChild('digilentProgressBar') progressBarComponent: ProgressBarComponent;
    public storageService: StorageService;
    public settingsService: SettingsService;
    public loadingCtrl: LoadingController;
    public params: NavParams;
    public viewCtrl: ViewController;
    public deviceManagerService: DeviceManagerService;
    public updateComplete: boolean = false;

    public deviceFirmwareVersion: string = '';
    public latestFirmwareVersion: string = 'Unable to load latest firmware version.';
    public updateStatus: string = 'Ready';

    public deviceObject: DeviceCardInfo;
    public agentAddress: string;
    public firmwareUpToDate: boolean = false;

    public availableFirmwareVersions: string[] = ['None'];

    public selectedFirmwareVersion: string = '';
    public hexFileStaged: boolean = false;

    public selectedFileInfo: { name: string, size: number } = { name: '', size: 0 };

    public arrayBufferFirmware: ArrayBuffer;
    public uploadStatusAttemptCount: number = 0;
    public maxUploadStatusAttempts: number = 20;

    constructor(
        _storageService: StorageService,
        _settingsService: SettingsService,
        _params: NavParams,
        _viewCtrl: ViewController,
        _loadingCtrl: LoadingController,
        _deviceManagerService: DeviceManagerService
    ) {
        this.deviceManagerService = _deviceManagerService;
        this.storageService = _storageService;
        this.loadingCtrl = _loadingCtrl;
        this.settingsService = _settingsService;
        this.viewCtrl = _viewCtrl;
        this.params = _params;
        this.agentAddress = this.params.get('agentAddress');
        this.deviceObject = this.params.get('deviceObject');
        console.log('update firmware constructor');
        this.deviceManagerService.transport.setHttpTransport(this.deviceObject.deviceBridgeAddress);
        this.getDeviceFirmware();
        this.getFirmwareList();
    }

    getDeviceFirmware() {
        let firmwareVersionObject = this.deviceObject.deviceDescriptor.firmwareVersion;
        let deviceFirmwareVersion = [firmwareVersionObject.major, firmwareVersionObject.minor, firmwareVersionObject.patch].join('.');
        this.deviceFirmwareVersion = deviceFirmwareVersion;
    }

    getFirmwareList() {
        this.deviceManagerService.getFirmwareVersionsFromUrl('https://s3-us-west-2.amazonaws.com/digilent-test').then((firmwareVersionArray: string[]) => {
            console.log(firmwareVersionArray);
            this.availableFirmwareVersions = firmwareVersionArray;
            this.getLatestFirmware();
            this.availableFirmwareVersions.push('Other');
        }).catch((e) => {
            console.log(e);
            this.availableFirmwareVersions = ['Other'];
            this.availableFirmwareVersionsChange('Other');
            this.updateStatus = 'Unable to get firmware versions. Please upload a local hex file.';
        });
    }

    getFirmwareFromUrl(firmwareUrl: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.deviceManagerService.transport.getRequest(firmwareUrl).subscribe(
                (data) => {
                    //console.log(data);
                    console.log('got hex file');
                    let buf = new ArrayBuffer(data.length);
                    let bufView = new Uint8Array(buf);
                    for (var i = 0; i < data.length; i < i++) {
                        bufView[i] = data.charCodeAt(i);
                    }
                    this.arrayBufferFirmware = buf;
                    this.postHexFile()
                        .then(() => {
                            resolve();
                        })
                        .catch((e) => {
                            reject(e);
                        });
                },
                (err) => {
                    console.log(err);
                    reject(err);
                },
                () => { }
            );
        });
    }

    availableFirmwareVersionsChange(event) {
        console.log(event);
        this.selectedFirmwareVersion = event;
        if (event === 'Other') {
            this.hexFileStaged = true;
            if (this.selectedFileInfo.size !== 0) {
                this.updateStatus = 'Ready to upload "' + this.selectedFileInfo.name + '". File size is ' + this.selectedFileInfo.size + ' bytes.';
                this.firmwareUpToDate = false;
            }
            else {
                this.firmwareUpToDate = true;
                this.updateStatus = 'Select a hex file to upload';
            }
            return;
        }
        this.hexFileStaged = false;
        this.firmwareUpToDate = this.deviceFirmwareVersion === event;
        if (this.firmwareUpToDate) {
            this.updateStatus = 'Firmware up to date';
            return;
        }
        this.updateStatus = 'Ready to upload firmware version ' + event;
    }

    openFileInput() {
        document.getElementById('updateFileSelect').click();
    }

    fileChange(event) {
        if (event.target.files.length === 0) { return; }
        let fileReader = new FileReader();
        let fileName = event.target.files[0].name;
        this.selectedFileInfo.name = fileName;
        this.updateStatus = 'Ready to upload "' + fileName + '".';
        let fileEnding = fileName.slice(fileName.indexOf('.') + 1);
        if (fileEnding === 'hex') {
            fileReader.onload = ((file: any) => {
                this.updateStatus += '\r\nFile size is ' + file.loaded + ' bytes.';
                this.selectedFileInfo.size = parseInt(file.loaded);
                this.arrayBufferFirmware = file.target.result;
                this.firmwareUpToDate = false;
            });
            fileReader.readAsArrayBuffer(event.target.files[0]);
        }
        else {
            alert('You Must Upload A Hex File');
        }

    }

    getLatestFirmware() {
        //TODO: read device enum for ip address and then call device man service getFirmwareVersionsFromUrl
        this.latestFirmwareVersion = this.deviceManagerService.getLatestFirmwareVersionFromArray(this.availableFirmwareVersions);
        this.firmwareUpToDate = this.latestFirmwareVersion === this.deviceFirmwareVersion;
        if (this.firmwareUpToDate) {
            this.updateStatus = 'Your device firmware is up to date';
        }
        this.selectedFirmwareVersion = this.latestFirmwareVersion;
    }

    displayLoading(message?: string) {
        message = message || 'Attempting To Upload...';
        let loading = this.loadingCtrl.create({
            content: message,
            spinner: 'crescent',
            cssClass: 'custom-loading-indicator'
        });

        loading.present();

        return loading;
    }

    //Need to use this lifestyle hook to make sure the slider exists before trying to get a reference to it
    ionViewDidEnter() {
        let swiperInstance: any = this.slider.getSlider();
        if (swiperInstance == undefined) {
            setTimeout(() => {
                this.ionViewDidEnter();
            }, 20);
            return;
        }
        swiperInstance.lockSwipes();
    }

    toProgressBar() {
        console.log(this.selectedFirmwareVersion);
        let loading = this.displayLoading();
        this.sendHexFile()
            .then(() => {
                let swiperInstance: any = this.slider.getSlider();
                swiperInstance.unlockSwipes();
                this.slider.slideTo(1);
                swiperInstance.lockSwipes();
                this.progressBarComponent.manualStart();
                loading.dismiss();
            })
            .catch((e) => {
                console.log('Error caught trying to upload the firmware');
                loading.dismiss();
                if (e === 'HTTP Timeout: ') {
                    let swiperInstance: any = this.slider.getSlider();
                    swiperInstance.unlockSwipes();
                    this.slider.slideTo(1);
                    swiperInstance.lockSwipes();
                    this.progressBarComponent.manualStart();
                    this.getUploadStatus();
                    return;
                }
                this.updateStatus = 'Error uploading firmware. Please try again.';
            });
    }

    sendHexFile(): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.selectedFirmwareVersion === 'Other' && !this.arrayBufferFirmware) {
                this.updateStatus = 'Please select a hex file to upload or choose from the default firmware.';
                reject();
            }
            else if (this.selectedFirmwareVersion === 'Other' && this.arrayBufferFirmware) {
                this.postHexFile()
                    .then(() => {
                        resolve();
                    })
                    .catch((e) => {
                        reject(e);
                    });
            }
            else {
                this.getFirmwareFromUrl('https://s3-us-west-2.amazonaws.com/digilent-test' + '/' + this.selectedFirmwareVersion + '.hex')
                    .then(() => {
                        resolve();
                    })
                    .catch((e) => {
                        reject(e);
                    });
            }
        });
    }

    getUploadStatus() {
        let command = {
            "agent": [
                {
                    "command": "updateFirmwareGetStatus"
                }
            ]
        };
        this.deviceManagerService.transport.writeRead('/config', JSON.stringify(command), 'json').subscribe(
            (data) => {
                data = this.arrayBufferToObject(data);
                if (data.agent && data.agent[0].status && data.agent[0].status === 'uploading' && data.agent[0].progress) {
                    this.progressBarComponent.manualUpdateVal(data.agent[0].progress);
                }
                if (data.agent == undefined || data.agent[0].statusCode > 0 || data.agent[0].status !== 'idle' && this.uploadStatusAttemptCount < this.maxUploadStatusAttempts) {
                    console.log('statusCode error');
                    this.uploadStatusAttemptCount++;
                    setTimeout(() => {
                        this.getUploadStatus();
                    }, 1000);
                    return;
                }
                if (data.agent[0].status === 'idle') {
                    this.progressBarComponent.manualUpdateVal(100);
                }
            },
            (err) => {
                console.log(err);
            },
            () => { }
        );

    }

    doneUpdating() {
        let loading = this.displayLoading('Reconnecting To Device');
        this.uploadStatusAttemptCount = 0;
        this.enterJsonModeAttemptWrapper(loading);
    }

    enterJsonModeAttemptWrapper(loadingRef: any) {
        setTimeout(() => {
            this.enterJsonMode()
                .then(() => {
                    console.log('entered json mode');
                    this.updateComplete = true;
                    loadingRef.dismiss();
                })
                .catch((e) => {
                    console.log(e);
                    if (this.uploadStatusAttemptCount < this.maxUploadStatusAttempts) {
                        this.uploadStatusAttemptCount++;
                        this.enterJsonModeAttemptWrapper(loadingRef);
                    }
                    else {
                        loadingRef.dismiss();
                    }
                });
        }, 1000);
    }

    enterJsonMode(): Promise<any> {
        let command = {
            "agent": [
                {
                    "command": "enterJsonMode"
                }
            ]
        };
        return new Promise((resolve, reject) => {
            this.deviceManagerService.transport.writeRead('/config', JSON.stringify(command), 'json').subscribe(
                (arrayBuffer) => {
                    console.log('enter json mode');
                    let data;
                    try {
                        let stringify = String.fromCharCode.apply(null, new Int8Array(arrayBuffer.slice(0)));
                        console.log(stringify);
                        data = JSON.parse(stringify);
                    }
                    catch (e) {
                        console.log('Error Parsing JSON mode Device Response');
                        console.log(e);
                        reject(e);
                    }
                    if (data.agent[0] == undefined || data.agent[0].statusCode > 0) {
                        reject(data);
                        return;
                    }
                    console.log(data);
                    resolve(data);
                },
                (err) => {
                    console.log(err);
                    reject(err);
                },
                () => { }
            );

        });
    }

    closeModal() {
        this.viewCtrl.dismiss();
    }

    postHexFile(): Promise<any> {
        //this.processBinaryDataAndSend(this.arrayBufferFirmware);
        return new Promise((resolve, reject) => {
            this.deviceManagerService.transport.writeRead('/config', this.generateOsjb(this.arrayBufferFirmware), 'binary').subscribe(
                (data) => {
                    data = this.arrayBufferToObject(data);
                    resolve(data);
                },
                (err) => {
                    console.log(err);
                    reject(err);
                },
                () => { }
            );
        });
    }

    generateOsjb(firmwareArrayBuffer: ArrayBuffer) {
        let commandObject = {
            agent: [{
                command: 'uploadFirmware',
                enterBootloader: true
            }]
        };
        let stringCommand = JSON.stringify(commandObject);
        let binaryIndex = (stringCommand.length + 2).toString() + '\r\n';

        let stringSection = binaryIndex + stringCommand + '\r\n';
        let binaryBufferStringSectionArrayBuf = new ArrayBuffer(stringSection.length);
        let binaryBufferStringSection = new Uint8Array(binaryBufferStringSectionArrayBuf);
        for (let i = 0; i < stringSection.length; i++) {
            binaryBufferStringSection[i] = stringSection.charCodeAt(i);
        }

        let temp = new Uint8Array(stringSection.length + firmwareArrayBuffer.byteLength);
        temp.set(new Uint8Array(binaryBufferStringSection), 0);
        temp.set(new Uint8Array(firmwareArrayBuffer), binaryBufferStringSection.byteLength);
        return temp;
    }

    arrayBufferToObject(arrayBuffer) {
        let data;
        try {
            let stringify = String.fromCharCode.apply(null, new Int8Array(arrayBuffer.slice(0)));
            console.log(stringify);
            data = JSON.parse(stringify);
        }
        catch (e) {
            return;
        }
        if (data.agent == undefined || data.agent[0].statusCode > 0) {
            return;
        }
        return data;
    }

}