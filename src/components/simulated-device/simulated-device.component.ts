import {Component} from '@angular/core';
import {Observable} from 'rxjs/Observable';
import 'rxjs/Rx';

//Components
import {SimulatedAwgComponent} from './instruments/simulated-awg.component';
import {SimulatedDcComponent} from './instruments/simulated-dc.component';
import {SimulatedOscComponent} from './instruments/simulated-osc.component';
import {SimulatedTriggerComponent} from './instruments/simulated-trigger.component';
import {SimulatedLaComponent} from './instruments/simulated-la.component';
import {SimulatedGpioComponent} from './instruments/simulated-gpio.component';

//Services
import {SimulatedDeviceService} from '../../services/simulated-device/simulated-device.service';

@Component({

})
export class SimulatedDeviceComponent {

    public streamState: {
        mode: string,
        remainingSamples: number
    };
    public descriptor: string;
    public awg: SimulatedAwgComponent;
    public dc: SimulatedDcComponent;
    public la: SimulatedLaComponent;
    public osc: SimulatedOscComponent;
    public trigger: SimulatedTriggerComponent;
    public gpio: SimulatedGpioComponent;
    public simDevService: SimulatedDeviceService;

    constructor(enumeration) {
        this.descriptor = enumeration;
        this.simDevService = new SimulatedDeviceService();
        this.awg = new SimulatedAwgComponent(this.simDevService);
        this.dc = new SimulatedDcComponent(this.simDevService);
        this.osc = new SimulatedOscComponent(this.simDevService);
        this.trigger = new SimulatedTriggerComponent(this.simDevService);
        this.la = new SimulatedLaComponent(this.simDevService);
        this.gpio = new SimulatedGpioComponent(this.simDevService);
    }

    send(command: any): Observable<any> {
        return Observable.create((observer) => {
            observer.next(this.parseCommand(JSON.parse(command)));
            observer.complete();
        })
    }

    parseCommand(event) {
        let responseObject: any = {};
        let sumStatusCode = 0;
        let binaryDataFlag = 0;
        for (let instrument in event) {
            //create property on response object
            responseObject[instrument] = {};
            if (event[instrument][0] !== undefined && event[instrument][0].command !== undefined) {
                if (instrument === 'device') {
                    responseObject[instrument] = [];
                    let activeIndex = responseObject[instrument].push(this.processCommands(instrument, event[instrument][0], [])) - 1;
                    sumStatusCode += responseObject[instrument][activeIndex].statusCode;
                }
                else {
                    responseObject[instrument] = this.processCommands(instrument, event[instrument][0], []);
                    sumStatusCode += responseObject[instrument].statusCode;
                }

            }

            for (let channel in event[instrument]) {
                if (event[instrument][channel][0] !== undefined) {
                    //create property on response object 
                    responseObject[instrument][channel] = [];
                    event[instrument][channel].forEach((element, index, array) => {
                        let activeIndex = responseObject[instrument][channel].push(this.processCommands(instrument, event[instrument][channel][index], [channel])) - 1;
                        if (element.command === 'read') {
                            binaryDataFlag = 1;
                        }
                    });

                }

            }
        }
        if (binaryDataFlag) {
            return this.processBinaryDataAndSend(responseObject); 
        }
        else {
            let response = JSON.stringify(responseObject);
            let buf = new ArrayBuffer(response.length);
            let bufView = new Uint8Array(buf);
            for (let i = 0; i < response.length; i++) {
                bufView[i] = response.charCodeAt(i);
            }
            return bufView.buffer;
        }
    }

    processCommands(instrument: any, commandObject: any, params: any) {
        let command = instrument + commandObject.command;
        switch (command) {
            //---------- Device ----------
            case 'deviceenumerate':
                return JSON.parse(this.descriptor);

            //---------- AWG ----------            
            case 'awgsetArbitraryWaveform':
                return this.awg.setArbitraryWaveform(params[0]);
            case 'awgsetRegularWaveform':
                return this.awg.setRegularWaveform(params[0], commandObject);
            case 'awgrun':
                return this.awg.run(params[0]);
            case 'awgstop':
                return this.awg.stop(params[0]);

            //---------- DC ----------        
            case 'dcsetVoltage':
                return this.dc.setVoltage(params[0], commandObject.voltage);
            case 'dcgetVoltage':
                return this.dc.getVoltage(params[0]);
            
            //---------- GPIO ----------        
            case 'gpiosetValue':
                return this.gpio.setValue(params[0], commandObject.value);
            case 'gpiogetValue':
                return this.gpio.getValue(params[0]);
            case 'gpiosetDirection':
                return this.gpio.setDirection(params[0], commandObject.value);
            case 'gpiogetDirection':
                return this.gpio.getDirection(params[0]);

            //-------- TRIGGER --------
            case 'triggersetParameters':
                return this.trigger.setParameters(params[0], commandObject.source, commandObject.targets);
            case 'triggersingle':
                return this.trigger.single();

            //---------- OSC ----------            
            case 'oscsetParameters':
                return this.osc.setParameters(params[0], commandObject);
            case 'oscread':
                return this.osc.read(params[0]);

            //---------- LA ----------            
            case 'lasetParameters':
                return this.la.setParameters(params[0], commandObject);
            case 'laread':
                return this.la.read(params[0]);

            default:
                return {
                    statusCode: 1,
                    errorMessage: 'Not a recognized command'
                };
        }
    }

    processBinaryDataAndSend(commandObject: any) {
        let binaryDataContainer = {};
        let binaryOffset = 0;
            for (let instrument in this.trigger.targets) {

                for (let channel in commandObject[instrument]) {
                    binaryDataContainer[channel] = commandObject[instrument][channel][0].y;
                    commandObject[instrument][channel][0].binaryOffset = binaryOffset;
                    binaryOffset += commandObject[instrument][channel][0].binaryLength;
                    delete commandObject[instrument][channel][0].y;
                }

            }

        let stringCommand = JSON.stringify(commandObject);
        let binaryIndex = (stringCommand.length + 2).toString() + '\r\n';

        let stringSection = binaryIndex + stringCommand + '\r\n';
        let buf = new ArrayBuffer(stringSection.length + binaryOffset);
        let bufView = new Uint8Array(buf);
        for (let i = 0; i < stringSection.length; i++) {
            bufView[i] = stringSection.charCodeAt(i);
        }
        let binaryInjectorIndex = 0;
        let prevLength = 0;
        for (let channel in binaryDataContainer) {
            let unsignedConversion = new Uint8Array(binaryDataContainer[channel].buffer);
            binaryInjectorIndex += prevLength + unsignedConversion.length;
            for (let i = stringSection.length + prevLength, j = 0; i < binaryInjectorIndex + stringSection.length; i = i + 2, j = j + 2) {
                bufView[i] = unsignedConversion[j];
                bufView[i + 1] = unsignedConversion[j + 1];
            }
            prevLength = unsignedConversion.length;
        }
        return bufView.buffer;
    }
}