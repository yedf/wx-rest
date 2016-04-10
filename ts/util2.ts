'use strict';
import * as fs from 'fs';
var request = require('request');
import * as express from 'express';
var parser = require('xml2json');
var md5 = require('md5');
import * as _ from 'underscore';

export async function get(url) {
  return new Promise(function(resolve, reject) {
    console.log(`getting ${url}`);
    request(url, function(err, response, body) {
      console.log(`get ${url} body: ${body}`);
      err && reject(err) || resolve(body);
    });
  });
}
export async function getRaw(url) {
  return new Promise(function(resolve, reject) {
    let data = '';
    console.log(`getting raw ${url}`);
    request(url).on('response', (response)=>{
      response.setEncoding('binary');
      response.on('data', chunk=>{
        data += chunk;
      })
      .on('end',()=> {
        console.log(`get raw ${url} body length: ${data.length}`);
        resolve(data);
      });
    });
  });
}
export async function jget(url) {
  return get(url).then(function(res:any) { return Promise.resolve(JSON.parse(res)); })
}
export async function jpost(url,data) {
  return post(url,JSON.stringify(data)).then(function(res:any) { return Promise.resolve(JSON.parse(res)); })
}
export async function post(url, data) {
  return new Promise(function(resolve, reject) {
    console.log(`posting raw ${url} data length: ${data.length}`);
    request({
      url: url,
      method: 'POST',
      body: data,
    }, (err, response, body) => {
      console.log(`post ${url} body ${JSON.stringify(data)} err ${err} body ${body}`);
      err && reject(err) || resolve(body);
    });
  });
}
export async function eachResult(result, cb) {
  if (_.isArray(result)) {
    for (let i in result) {
      await cb(result[i], i);
    }
  } else {
    await cb(result, 0);
  }
}

export async function postForm(url, formData) {
  return new Promise((resolve,reject) => {
    console.log(`posting ${url} form: ${JSON.stringify(formData)}`);
      request.post({url:url,formData:formData}, (err,response,body)=> {
          console.log(`post ${url} body ${JSON.stringify(formData)} err ${err} body ${body}`);
          err && reject(err) || resolve(body);
      })
  });
}

export function base64(img:string):boolean { return img && img.startsWith('data:'); }
export function base64Buffer(img:string): Buffer {
  let pat = 'base64,'
  let pos = img.indexOf(pat);
  return new Buffer(img.slice(pos+pat.length), 'base64');
}
export function base64Ext(img:string) {
  let regex = /^data:.+\/(.+);base64,(.*)$/;
  let matches = img.slice(0,30).match(regex);
  return matches[1];
}
export function base64Save(img: string, filename:string) {
  console.log('begin saving base64');
  let buffer = base64Buffer(img);
  console.log('writing to file ', filename, ' bytes: ', buffer.length);
  fs.writeFileSync(filename, buffer);
}

export function createNonceStr(length) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars.charAt(Math.floor(Math.random()*chars.length));
  }
  return str;
}
export function getTimeStamp(){
  return Math.floor(new Date().getTime()/1000);
}

export function sha1(s1){
  let cry = require('crypto');
  let shasum= cry.createHash('sha1');
  shasum.update(s1);
  return shasum.digest('hex');
}

export function getIp(req) {
  let ip:string = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (ip.indexOf(':')>=0) {
    ip = ip.split(':').slice(-1)[0];
  }
  if (ip.endsWith('127.0.0.1')) {
    ip = '118.244.254.29';
  }
  return ip;
}

export function toXml(obj) {
  let xml = '<xml>';
  for (let i in obj) {
    let v = obj[i];
    if (typeof i == 'number') {
      xml += `<${i}>${v}</${i}>`;
    } else {
      xml += `<${i}><![CDATA[${v}]]></${i}>`;
    }
  }
  xml += '</xml>';
  console.log('xml is: ', xml);
  return xml;
}
export function fromXml(xml) { return JSON.parse(parser.toJson(xml)); }

export function ascSign(obj, key:string) {
  let keys = _.keys(obj).sort();
  let s = '';
  for(let k of keys) {
    let v = obj[k];
    if (k != 'sign' && v && typeof v != 'Array') {
      s += `${k}=${v}&`;
    }
  }
  s += `key=${key}`;
  console.log('str to sign:', s);
  s = md5(s);
  s = s.toUpperCase();
  return s;
}
export function mysql_real_escape_string (str) {
  if (typeof str != 'string') return str;
  return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
    switch (char) {
      case "\0":
        return "\\0";
      case "\x08":
        return "\\b";
      case "\x09":
        return "\\t";
      case "\x1a":
        return "\\z";
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\"":
      case "'":
      case "\\":
      case "%":
        return "\\"+char; // prepends a backslash to backslash, percent,
                          // and double/single quotes
    }
  });
}