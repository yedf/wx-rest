
'use strict';

import {Rest} from './rest-mysql';
import {Request,Response} from 'express';
import * as fs from 'fs';
var request = require('request');
import * as express from 'express';
import * as util from './util2';
export class WxRest extends Rest {
  constructor(public config: any) {
    super(config);
    let that = this;
    this.app.get('/api/wx/redirect', function(req,res) {
      let url = req.query.url;
      console.log('redirect to: ', url);
      res.redirect(url);
    })
    .get('/api/wx/oauth', async function(req, res) {
      let code = req.query.code;
      let state = req.query.state; //state=epeijing.cn/app/ /tab/try
      state = state.replace(' ', '#');
      let tr:any = await util.jget(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${config.app_id}&secret=${config.app_secret}&grant_type=authorization_code&code=${code}`);
      console.log(`oauth token. code: ${code} state: ${state} openid: ${tr.openid}`);
      let userinfo = await util.jget(`https://api.weixin.qq.com/sns/userinfo?access_token=${tr.access_token}&openid=${tr.openid}&lang=zh_CN`);
      let info = encodeURI(JSON.stringify(userinfo));
      let url = `${state}?userinfo=${info}`;
      console.log('url is', url);
      res.redirect(url);
      return Promise.resolve(true);
    })
    .get('/api/wx/weixin_token', async function(req, res) {
      let token = await that.getWeixinToken();
      res.send({token:token});
    })
    .get('/api/wx/weixin_image', async function (req:Request,res:Response) {
      let id = req.query.id;
      let token = await that.getWeixinToken();
      let url = `http://file.api.weixin.qq.com/cgi-bin/media/get?access_token=${token}&media_id=${id}`;
      console.log(`downloading weixin: ${url}`);
      let body:any = await util.getRaw(url);
      res.contentType('image/jpeg').end(body,'binary');
    })
    .get('/api/wx/weixin_ticket', async function(req, res) {
      let ticket = await that.getWeixinTicket();
      res.send({ticket:ticket});
    })
    .get('/api/wx/get_sign', async function(req, res) {
      let sign = await that.getSign(req.query.url);
      console.log('sign is: ', sign);
      res.send(sign);
    })
  }
  async cacheSet  (key, value, expire) {
    await this.query(`delete from n_cache where key1='${key}' and expire < unix_timestamp()`);
    await this.query(`insert into n_cache(key1, value1, expire, create_time) values('${key}', '${value}', unix_timestamp()+${expire}, now())`);
  }
  async cacheGet (key) {
    let sql = `select value1 from n_cache where key1='${key}' and expire > unix_timestamp() limit 1`;
    let rs = await this.queryOne(sql);
    let res = null;
    if(rs && rs.hasOwnProperty('value1') && rs.value1)
      res = rs.value1;
    console.log('cacheGet:', key, res);
    return res;
  }
  async getWeixinToken () {
    if (!process.env.PRODUCT) {
      let r:any = await util.jget(`http://${this.config.product_host}/api/wx/weixin_token`);
      console.log(`weixin token get: `,r);
      return r.token;
    }
    let token = await this.cacheGet(`weixin-token`);
    if (token) {
      return token;
    }
    let app_id = this.config.app_id;
    let app_secret = this.config.app_secret;
    let url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${app_id}&secret=${app_secret}`;
    let get_res:any =  await util.jget(url);
    console.log(`weixin get token: app_id: ${app_id} result: ${get_res}`);
    let weixin_token = get_res.access_token;
    await this.cacheSet( `weixin-token`, weixin_token, 7000);
    return Promise.resolve(weixin_token);
  }
  async getWeixinTicket () {
    if (!process.env.PRODUCT) {
      let r:any = await util.jget(`http://${this.config.product_host}/api/wx/weixin_ticket`);
      console.log(`weixin token get: ${r}`);
      return r.ticket;
    }
    let ticket = await this.cacheGet( "weixin-ticket");
    console.log('cacheget ticket: ',ticket);
    if (ticket) {
      return ticket;
    }
    let token = await this.getWeixinToken();
    let url = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${token}&type=jsapi`;
    let get_res:any = await util.jget(url);
    ticket = get_res.ticket;
    console.log('new tickect ',ticket)
    await this.cacheSet( "weixin-ticket", ticket, 7000);
    return ticket;
  }
  async sendTemplateMsg(msg) {
    let token = await this.getWeixinToken();
    let purl = 'https://api.weixin.qq.com/cgi-bin/message/template/send?access_token='+token;
    let phr:any = await util.jpost(purl, msg);
    console.log(`send weixin msg: ${purl} `, msg, phr);
    return phr.errcode == 0;
  }
  async getSign(url){
    const jsapiTicket = await this.getWeixinTicket();
    const timestamp = util.getTimeStamp();
    const nonceStr = util.createNonceStr(16);
    // 这里参数的顺序要按照 key 值 ASCII 码升序排序
    let str = `jsapi_ticket=${jsapiTicket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
    let signature = util.sha1(str);
    const signPackage = {
      appId: this.config.app_id,
      nonceStr: nonceStr,
      timestamp: timestamp,
      url: url,
      signature: signature,
      rawString: str
    };
    return Promise.resolve(signPackage);
  }

  async unified_order(sn, wx_id, price, ip):Promise<any> {
    let input = {
      appid: this.config.app_id,
      mch_id: this.config.wx_pay.mchid,
      nonce_str: util.createNonceStr(8),
      spbill_create_ip: ip,
      notify_url: "http://paysdk.weixin.qq.com/example/notify.php",
      trade_type:'JSAPI',
      openid: wx_id,
      body: "sn-"+sn,
      out_trade_no: sn,
      total_fee: price,
      sign:'',
    }
    input.sign = util.ascSign(input, this.config.wx_pay.key);
    let xml = util.toXml(input);
    let pr = await util.post('https://api.mch.weixin.qq.com/pay/unifiedorder', xml);
    console.log(pr);
    let jr = util.fromXml(pr);
    console.log(jr);
    if (!jr.xml.prepay_id) {
      return Promise.resolve({success:0,message:jr.xml.err_code_des});
    }
    let apiPay = {
      appId: this.config.app_id,
      timeStamp: `${util.getTimeStamp()}`,
      nonceStr: util.createNonceStr(8),
      package: 'prepay_id='+jr.xml.prepay_id,
      signType: 'MD5',
    }
    apiPay['paySign'] = util.ascSign(apiPay, this.config.wx_pay.key);
    // let r_sn = sn.endsWith('a') ? sn.slice(0, -1) : sn;
    // let table = req.query.type == 'corp' ? 'n_order_shop' : 'n_order';
    // let sql = `update ${table} set pay_status='paying', update_time=now(),pay_query=unix_timestamp( ) where sn='${r_sn}'`;
    // rest.query(sql);
    return Promise.resolve(apiPay)
  }

  async order_query_raw(sn) {
    let input = {
      out_trade_no: sn,
      appid: this.config.app_id,
      mch_id: this.config.wx_pay.mchid,
      nonce_str: util.createNonceStr(8),    
    }
    input['sign'] = util.ascSign(input, this.config.wx_pay.key);
    let xml = util.toXml(input);
    let pr = await util.post('https://api.mch.weixin.qq.com/pay/orderquery', xml);
    console.log(pr);
    let jr = util.fromXml(pr);
    return Promise.resolve(jr.xml.trade_state && jr.xml.trade_state=='SUCCESS');  
  }
  
}

