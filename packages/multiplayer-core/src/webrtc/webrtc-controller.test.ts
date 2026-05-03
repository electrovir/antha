import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {assertValidShape} from 'object-shape-tester';
import {webrtcAnswerShape, webrtcOfferShape} from './web-rtc-communication.js';
import {toPlainSessionDescription} from './webrtc-controller.js';

describe(toPlainSessionDescription.name, () => {
    it('extracts type and sdp into a plain object', () => {
        const description = new RTCSessionDescription({
            type: 'offer',
            sdp: 'v=0\r\n',
        });

        assert.deepEquals(toPlainSessionDescription(description), {
            type: 'offer',
            sdp: 'v=0\r\n',
        });
    });

    it('produces an object that passes webrtcOfferShape validation', () => {
        const description = new RTCSessionDescription({
            type: 'offer',
            sdp: 'v=0\r\n',
        });

        assertValidShape(toPlainSessionDescription(description), webrtcOfferShape);
    });

    it('produces an object that passes webrtcAnswerShape validation', () => {
        const description = new RTCSessionDescription({
            type: 'answer',
            sdp: 'v=0\r\n',
        });

        assertValidShape(toPlainSessionDescription(description), webrtcAnswerShape);
    });

    it('produces own enumerable properties', () => {
        const description = new RTCSessionDescription({
            type: 'offer',
            sdp: 'v=0\r\n',
        });

        const plain = toPlainSessionDescription(description);

        assert.deepEquals(Object.keys(plain).sort(), [
            'sdp',
            'type',
        ]);
    });
});
