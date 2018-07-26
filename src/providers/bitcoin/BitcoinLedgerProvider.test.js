/* eslint-env jest */

import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import BitcoinLedgerProvider from 'BitcoinLedgerProvider'

chai.use(chaiAsPromised)

const { expect } = chai

const lib = new BitcoinLedgerProvider()

describe('Bitcoin Ledger provider', () => {
  describe('Generate swap', () => {
    it('should generate correct bytecode', () => {
      return expect(lib.generateSwap('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'ffffffffffffffffffffffffffffffffffffffff',
        1532622116403))
        .to.equal('76a97263a914ffffffffffffffffffffffffffffffffffffffff8814bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb6705339665d700b16d14aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6888ac')
    })
  })
})
