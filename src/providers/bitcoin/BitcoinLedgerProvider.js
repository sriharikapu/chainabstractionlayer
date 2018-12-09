import LedgerProvider from '../LedgerProvider'
import Bitcoin from '@ledgerhq/hw-app-btc'

import { BigNumber } from 'bignumber.js'
import { base58, padHexStart } from '../../crypto'
import { pubKeyToAddress, addressToPubKeyHash } from './BitcoinUtil'
import Address from '../../Address'
import networks from '../../networks'

export default class BitcoinLedgerProvider extends LedgerProvider {
  constructor (chain = { network: networks.bitcoin, segwit: false }) {
    super(Bitcoin, `${chain.segwit ? '49' : '44'}'/${chain.network.coinType}'/0'/0/`)
    this._network = chain.network
    this._segwit = chain.segwit
    this._coinType = chain.network.coinType
  }

  async getPubKey (from) {
    const app = await this.getApp()
    const derivationPath = from.derivationPath ||
      await this.getDerivationPathFromAddress(from)

    return app.getWalletPublicKey(derivationPath)
  }

  async getAddressFromDerivationPath (path) {
    const app = await this.getApp()
    const { bitcoinAddress } = await app.getWalletPublicKey(path, false, this._segwit)
    return new Address(bitcoinAddress, path)
  }

  async signMessage (message, from) {
    const app = await this.getApp()
    const derivationPath = from.derivationPath ||
      await this.getDerivationPathFromAddress(from)

    const hex = Buffer.from(message).toString('hex')
    return app.signMessageNew(derivationPath, hex)
  }

  async getUnusedAddress (from = {}) {
    let addressIndex = from.index || 0
    let unusedAddress = false

    while (!unusedAddress) {
      const address = await this.getAddressFromIndex(addressIndex)
      const isUsed = await this.getMethod('isAddressUsed')(address.address)

      if (!isUsed) {
        unusedAddress = address
      }

      addressIndex++
    }

    return unusedAddress
  }

  getAmountBuffer (amount) {
    let hexAmount = BigNumber(amount).toString(16)
    hexAmount = padHexStart(hexAmount, 16)
    const valueBuffer = Buffer.from(hexAmount, 'hex')
    return valueBuffer.reverse()
  }

  async splitTransaction (transactionHex, isSegwitSupported) {
    const app = await this.getApp()

    return app.splitTransaction(transactionHex, isSegwitSupported)
  }

  async serializeTransactionOutputs (transactionHex) {
    const app = await this.getApp()

    return app.serializeTransactionOutputs(transactionHex)
  }

  async signP2SHTransaction (inputs, associatedKeysets, changePath, outputScriptHex) {
    const app = await this.getApp()

    return app.signP2SHTransaction(inputs, associatedKeysets, changePath, outputScriptHex)
  }

  createScript (address) {
    const type = base58.decode(address).toString('hex').substring(0, 2).toUpperCase()
    const pubKeyHash = addressToPubKeyHash(address)

    if (type === this._network.pubKeyHash) {
      return [
        '76', // OP_DUP
        'a9', // OP_HASH160
        '14', // data size to be pushed
        pubKeyHash, // <PUB_KEY_HASH>
        '88', // OP_EQUALVERIFY
        'ac' // OP_CHECKSIG
      ].join('')
    } else if (type === this._network.scriptHash) {
      return [
        'a9', // OP_HASH160
        '14', // data size to be pushed
        pubKeyHash, // <PUB_KEY_HASH>
        '87' // OP_EQUAL
      ].join('')
    } else {
      throw new Error('Not a valid address:', address)
    }
  }

  calculateFee (numInputs, numOutputs, feePerByte) { // TODO: lazy fee estimation
    return ((numInputs * 148) + (numOutputs * 34) + 10) * feePerByte
  }

  async getUtxosForAmount (amount, numAddressPerCall = 10) {
    const utxosToUse = []
    let addressIndex = 0
    let currentAmount = 0
    let numOutputsOffset = 0

    const feePerByte = await this.getMethod('getFeePerByte')(this._numberOfBlockConfirmation)

    while (currentAmount < amount) {
      const addresses = await this.getAddresses(addressIndex, numAddressPerCall)
      const addressList = addresses.map(addr => addr.address)

      const utxos = await this.getMethod('getAddressUtxos')(addressList)

      utxos.forEach((utxo) => {
        if (currentAmount < amount) {
          const utxoVal = utxo.satoshis
          if (utxoVal > 0) {
            currentAmount += utxoVal
            addresses.forEach((address) => {
              if (address.address === utxo.address) {
                utxo.derivationPath = address.derivationPath
              }
            })
            utxosToUse.push(utxo)

            const fees = this.calculateFee(utxosToUse.length, numOutputsOffset + 1)
            let totalCost = amount + fees

            if (numOutputsOffset === 0 && currentAmount > totalCost) {
              numOutputsOffset = 1
              totalCost -= fees
              totalCost += this.calculateFee(utxosToUse.length, 2, feePerByte)
            }
          }
        }
      })

      addressIndex += numAddressPerCall
    }

    return utxosToUse
  }

  async getLedgerInputs (unspentOutputs) {
    const app = await this.getApp()

    return Promise.all(unspentOutputs.map(async utxo => {
      const hex = await this.getMethod('getTransactionHex')(utxo.txid)
      const tx = app.splitTransaction(hex, true)
      const vout = ('vout' in utxo) ? utxo.vout : utxo.outputIndex

      return [ tx, vout ]
    }))
  }

  async getWalletInfo (numAddressPerCall = 10, from = {}) {
    let addressIndex = from.index || 0
    let unusedAddress = false
    let usedAddresses = []
    let balance = 0

    while (!unusedAddress) {
      let addresses = await this.getAddresses(addressIndex, numAddressPerCall)
      const addressList = addresses.map(addr => addr.address)

      const addressDeltas = await this.getMethod('getAddressDeltas')(addressList)

      addressDeltas.forEach((delta) => {
        const addressIndex = addresses.findIndex(address => address.address === delta.address)
        if (addresses[addressIndex].balance === undefined) { addresses[addressIndex].balance = 0 }
        addresses[addressIndex].balance += delta.satoshis
        balance += delta.satoshis
      })

      addresses.forEach((address) => {
        if (!unusedAddress) {
          if (address.balance === undefined) {
            unusedAddress = address.address
          } else {
            usedAddresses.push(address.address)
          }
        }
      })

      addressIndex += numAddressPerCall
    }
    return { balance, unusedAddress, usedAddresses }
  }

  async sendTransaction (to, value, data, from) {
    const [ feePerByte, app ] = await Promise.all([
      this.getMethod('getFeePerByte')(),
      this.getApp()
    ])

    if (data) {
      const scriptPubKey = padHexStart(data)
      to = pubKeyToAddress(scriptPubKey, this._network.name, 'scriptHash')
    }

    const unusedAddress = await this.getUnusedAddress(from)
    const unspentOutputsToUse = await this.getUtxosForAmount(value, feePerByte)

    const totalAmount = unspentOutputsToUse.reduce((acc, utxo) => acc + utxo.satoshis, 0)
    const fee = this.calculateFee(unspentOutputsToUse.length, 1, feePerByte)
    let totalCost = value + fee
    let hasChange = false

    if (totalAmount > totalCost) {
      hasChange = true

      totalCost -= fee
      totalCost += this.calculateFee(unspentOutputsToUse.length, 2, feePerByte)
    }

    if (totalAmount < totalCost) {
      throw new Error('Not enough balance')
    }

    const ledgerInputs = await this.getLedgerInputs(unspentOutputsToUse)
    const paths = unspentOutputsToUse.map(utxo => utxo.derivationPath)

    const sendAmount = value
    const changeAmount = totalAmount - totalCost

    const sendScript = this.createScript(to)

    let outputs = [{ amount: this.getAmountBuffer(sendAmount), script: Buffer.from(sendScript, 'hex') }]

    if (hasChange) {
      const changeScript = this.createScript(unusedAddress.address)
      outputs.push({ amount: this.getAmountBuffer(changeAmount), script: Buffer.from(changeScript, 'hex') })
    }

    const serializedOutputs = app.serializeTransactionOutputs({ outputs }).toString('hex')
    const signedTransaction = await app.createPaymentTransactionNew(ledgerInputs, paths, unusedAddress.derivationPath, serializedOutputs)

    return this.getMethod('sendRawTransaction')(signedTransaction)
  }
}
