import { KeyPrivate, KeyPublic } from '../src/utils';
import { CryptoUtils } from '../src/crypt';
import { setLibRef } from './../src/helpers';
import * as dcorejs_lib from 'dcorejs-lib';
import { Utils } from '../src/utils';
import { expect } from 'chai';

const message = 'test message for encryption';
const encryptedMessage = '1bcd2ffea59c19cbff34b21e4c3d78947dd0fc8821e211b543395fcb52a35e15';
const secretWif = '5JDFQN3T8CFT1ynhgd5s574mTV9UPf9WamkHojBL4NgbhSBDmBj';
const pkeyString = 'DCT5dJjvk9k3yTsnJsAph6V8zEPxsAvJ7FCCzqYWiQQyVTiHvReLz';
let secret: KeyPrivate = null;
let pkey: KeyPublic = null;

function initLib() {
    setLibRef(dcorejs_lib);
    secret = Utils.privateKeyFromWif(secretWif);
    pkey = Utils.publicKeyFromString(pkeyString);
}

describe('Crypt helper test', () => {
    before(() => initLib());

    it('encrypt message', () => {
        const encryptedMsg = CryptoUtils.encryptWithChecksum(message, secret, pkey, '');
        expect(encryptedMsg).to.equal(encryptedMessage);
    });

    it('create md5 hash', () => {
        const hash = CryptoUtils.md5('dd.duskis+st14@gmail.com');
        expect(`u${hash}`).to.equal('u5d42a7b0b5713396aac58019eed01d53');
    });
});
