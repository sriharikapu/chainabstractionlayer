import _ from 'lodash'
import BigNumber from 'bignumber.js'
import JsonRpcProvider from '../JsonRpcProvider'

const { Transaction } = require('@zilliqa-js/account');
const { BN, Long, bytes, units } = require('@zilliqa-js/util');
const { Zilliqa } = require('@zilliqa-js/zilliqa');
const CP = require ('@zilliqa-js/crypto');

export default class ZilliqaRPCProvider {
  constructor (uri, refundPrivKey, redeemPrivKey) {
    super(uri, refundPrivKey, redeemPrivKey)
    this._zilliqa = new Zilliqa(uri)
    this._refundPrivKey = refundPrivKey
    this._redeemPrivKey = redeemPrivKey
  }

  async getAddresses () {
    const refundAddress = CP.getAddressFromPrivateKey(refundPrivKey)
    const redeemAddress = CP.getAddressFromPrivateKey(redeemPrivKey)
    return [{ address: refundAddress }, { address: redeemAddress}]
  }

  async signMessage (message) {
    const refundPubKey = CP.getPubKeyFromPrivateKey(this._refundPrivKey)
    return CP.sign(message, this._refundPrivKey, refundPubKey)
  }
}
