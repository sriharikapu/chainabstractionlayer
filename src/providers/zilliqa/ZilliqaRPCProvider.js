import _ from 'lodash'
import BigNumber from 'bignumber.js'
import Provider from '../../Provider'

const { Transaction } = require('@zilliqa-js/account');
const { BN, Long, bytes, units } = require('@zilliqa-js/util');
const { Zilliqa } = require('@zilliqa-js/zilliqa');
const CP = require ('@zilliqa-js/crypto');

export default class ZilliqaRPCProvider extends Provider {
  constructor (uri, refundPrivKey, redeemPrivKey, chain_id, msg_version) {
    super(uri, refundPrivKey, redeemPrivKey)
    this._zilliqa = new Zilliqa(uri)
    this._privKeys = { refund: refundPrivKey, redeem: redeemPrivKey }
    this._refundPrivKey = refundPrivKey
    this._redeemPrivKey = redeemPrivKey
    this._version = bytes.pack(chain_id, msg_version);
    this._gasPrice = units.toQa('1000', units.Units.Li)
  }

  async getAddresses () {
    const refundAddress = CP.getAddressFromPrivateKey(this._refundPrivKey)
    const redeemAddress = CP.getAddressFromPrivateKey(this._redeemPrivKey)
    return [{ address: refundAddress }, { address: redeemAddress}]
  }

  async signMessage (message) {
    const refundPubKey = CP.getPubKeyFromPrivateKey(this._refundPrivKey)
    const msgBuffer = Buffer.from(message)
    return CP.sign(msgBuffer, this._refundPrivKey, refundPubKey)
  }

  async deployContract (script, initParams, from) {
  	const contract = zilliqa.contracts.new(script, initParams)
  	const pubKey = CP.getPubKeyFromPrivateKey(this._privKeys[from])

    // Deploy the contract
    const [deployTx, htlc] = await contract.deploy({
      version: this._version,
      gasPrice: this._gasPrice,
      gasLimit: Long.fromNumber(8000),
      pubKey: pubKey
    });
    return { deployTx, htlc }
  }

  async callContract(contractAddress, transition, fields, value, from) {
  	const contract = zilliqa.contracts.at(contractAddress)
  	const pubKey = CP.getPubKeyFromPrivateKey(this._privKeys[from])

  	const callTx = await contract.call(
      transition, fields,
      {
        // amount, gasPrice and gasLimit must be explicitly provided
        version: VERSION,
        amount: new BN(value),
        gasPrice: this._gasPrice,
        gasLimit: Long.fromNumber(8000),
        pubKey: pubKey
      }
    );
  }
}
