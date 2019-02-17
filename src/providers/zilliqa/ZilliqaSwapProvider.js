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
      {
        vname: "_scilla_version",
        type: "Uint32",
        value: "0"
      },
      {
        vname: "refund_address",
        type: "ByStr20",
        value: `${refundAddress}`
      },
      {
        vname: "redeem_address",
        type: "ByStr20",
        value: `${recipientAddress}`
      },
      {
        vname: "expiration_blk",
        type: "BNum",
        value: expiration.toString()
      },
      {
        vname: "secretHash",
        type: "ByStr32",
        value: `0x${secretHash}`
      }
    ];

    console.log('Deploying Contract')
    const { deployTx, htlc } = await this.getMethod('deployContract')(htlcScript, init, 'refund')

    console.log('Funding Contract')
    await this.getMethod('callContract')(htlc.address, 'fund', [], value, 'refund')

    console.log('HTLC Initialized')
    return htlc.address
  }

  async claimSwap (contractAddress, recipientAddress, refundAddress, secret, expiration) {
    const fields = [
      {
        vname: "secret",
        type: "ByStr32",
        value: `0x${secret}`
      }
    ]

    return await this.getMethod('callContract')(contractAddress, 'claim', fields, 0, 'redeem')
  }

  async refundSwap (contractAddress, recipientAddress, refundAddress, secretHash, expiration) {
    return await this.getMethod('callContract')(contractAddress, 'expire', [], 0, 'refund')
  }
}