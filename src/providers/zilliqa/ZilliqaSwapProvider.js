import Provider from '../../Provider'

export default class ZilliqaSwapProvider extends Provider {

  createSwapScript (recipientAddress, refundAddress, secretHash, expiration) {
    const code = `scilla_version 0

    (***************************************************)
    (*               Associated library                *)
    (***************************************************)
    
    import BoolUtils
    
    library HTLCLib
    
    let blk_leq =
      fun (blk1 : BNum) =>
      fun (blk2 : BNum) =>
        let bc1 = builtin blt blk1 blk2 in 
        let bc2 = builtin eq blk1 blk2 in 
        orb bc1 bc2
    
    let one_msg = 
      fun (msg : Message) => 
        let nil_msg = Nil {Message} in
        Cons {Message} msg nil_msg
    
    let not_claimable_code = Int32 1
    let claimable_code = Int32 2
    let not_refundable_code = Int32 3
    let refundable_code = Int32 4
    
    
    (***************************************************)
    (*             Contract definition                 *)
    (***************************************************)
    
    contract HTLC
    
    (*  Parameters *)
    (refund_address    : ByStr20,
    redeem_address     : ByStr20,
    expiration_blk     : BNum,
    secretHash         : ByStr32)

    transition fund ()
      blk <- & BLOCKNUMBER;
      in_time = blk_leq blk expiration_blk;
      
      match in_time with
      | False =>
        e = {_eventname : "notClaimable"; code : not_claimable_code};
        event e
      | True =>
        accept;
        msg  = {_tag : ""; _recipient : _sender; _amount : Uint128 0; 
                code : claimable_code};
        msgs = one_msg msg;
        e = {_eventname : "Claimed"; code : claimable_code};
        event e;
        send msgs     
      end
    end

    transition claim (secret : ByStr32)
      hashed_secret = builtin sha256hash secret;
      is_correct_secret = builtin eq hashed_secret secretHash;
      blk <- & BLOCKNUMBER;
      bal <- _balance;
      in_time = blk_leq blk expiration_blk;
      is_claimable = andb is_correct_secret in_time;
    
      match is_claimable with
      | False =>
        e = {_eventname : "notClaimable"; code : not_claimable_code};
        event e
      | True =>
        msg  = {_tag : ""; _recipient : redeem_address; _amount : bal; 
                code : claimable_code};
        msgs = one_msg msg;
        e = {_eventname : "Claimed"; code : claimable_code};
        event e;
        send msgs     
      end
    end
    
    transition expire ()
      blk <- & BLOCKNUMBER;
      bal <- _balance;
      in_time = blk_leq blk expiration_blk;
      is_expired = negb in_time;
    
      match is_expired with
      | False =>
        e = {_eventname : "notRefundable"; code : not_refundable_code};
        event e
      | True =>
        msg  = {_tag : ""; _recipient : refund_address; _amount : bal; code : claimable_code};
        msgs = one_msg msg;
        e = {_eventname : "Claimed"; code : refundable_code};
        event e;
        send msgs     
      end
    end`;
    return code;
  }

	async initiateSwap (value, recipientAddress, refundAddress, secretHash, expiration) {
    const htlcScript = this.createSwapScript(recipientAddress, refundAddress, secretHash, expiration)
    const init = [
      // this parameter is mandatory for all init arrays
      {
        vname: "_scilla_version",
        type: "Uint32",
        value: "0"
      },
      {
        vname: "refund_address",
        type: "ByStr20",
        value: `0x${refundAddress}`
      },
      {
        vname: "redeem_address",
        type: "ByStr20",
        value: `0x${redeemAddress}`
      },
      {
        vname: "expiration_blk",
        type: "BNum",
        value: "90000"
      },
      {
        vname: "secretHash",
        type: "ByStr32",
        // NOTE: all byte strings passed to Scilla contracts _must_ be
        // prefixed with 0x. Failure to do so will result in the network
        // rejecting the transaction while consuming gas!
        value: "0x192f358b9eb5c51b27dff7a7cc82c8ffe058e2c92fdc2474b88bf5c41a14567f"
      }
    ];

    // Instance of class Contract
    const contract = zilliqa.contracts.new(code, init);

    // Deploy the contract
    const [deployTx, htlc] = await contract.deploy({
      version: VERSION,
      gasPrice: myGasPrice,
      gasLimit: Long.fromNumber(8000),
      pubKey: refundPubKey
    });

    const callFundTx = await htlc.call(
      "fund", [],
      {
        // amount, gasPrice and gasLimit must be explicitly provided
        version: VERSION,
        amount: new BN(units.toQa("1", units.Units.Zil)),
        gasPrice: myGasPrice,
        gasLimit: Long.fromNumber(8000),
        pubKey: refundPubKey
      }
    );

    return deployTx.id;
  }


}