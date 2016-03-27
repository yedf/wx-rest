'use strict';

import express = require('express');
import {Request,Response} from 'express';
import mysql = require("mysql");
import _ = require("underscore");
import * as fs from 'fs';
var parser:any = require('body-parser');
require("date-format-lite");
require('debug-trace')();
var proxy = require('express-http-proxy');
import * as util2 from './util2';

console['format'] = function(c) { return c.date + ": " + require('path').basename(c.filename) + ":" + c.getLineNumber(); };

function printable(body:any) {
  if (!body) return null;
  let s = JSON.stringify(body);
  if (s.length > 10*1024) return ` ... ${s.length} bytes`;
  return s;
}

export function create(option?:any):Rest {
  return new Rest(option);
}

export class Rest {
  app = express();
  conn:mysql.IConnection;
  custom:any = {};
  options = {
    mysql: process.env.MYSQL || 'mysql://root:@localhost/test',
    timeFormat: 'YYYY-MM-DD hh:mm:ss',
    port: 80,
    api: '/api/',
    custom: '', //custom processor for table request
    raw: '', // raw processor for request
    www: '', // web root for static
    call: '', // handle file/method request
    proxy: {
      //'/call_proxy': 'www.example.com'
    },
    bodyOption: {limit: '50mb'},
    verbose: true,
  };

  constructor(option?:any) {
    if (option.dir) {
      this.options.www = option.dir + '/../../www';
      this.options.custom = option.dir + '/custom';
      this.options.raw = option.dir + '/raw';
      this.options.call = option.dir + '/call';      
    }
    _.extendOwn(this.options, option);
    Date['masks']['default'] = this.options.timeFormat;
    console.log('connecting to mysql: ', this.options.mysql);
    this.conn = mysql.createConnection(this.options.mysql);
    setInterval(()=>{
      this.conn.query('select 1', (err,rows)=>{
        if (err) throw err;
        console.log('heart beat to mysql');
      })
    }, 120*1000);
    let table = this.options.api + 'table';
    console.log('table is at: ', table);
    this.app
      .use(require('morgan')('dev'))
      .use(require('connect-timeout')('20s'))
    for (let k in this.options.proxy) {
      let v = this.options.proxy[k];
      console.log('proxying: ', k, ' to: ', v);
      this.app.use(k, proxy(v, {
        forwardPath: (req,res)=>{ console.log('proxying: ', k+req.url, ' => ', v); return k+req.url;}
      }));
    }
    //.use(parser.raw({type: '*/*'}))
    this.app.use(parser['json'](this.options.bodyOption))
      .use(parser.urlencoded({ extended: true }))
      .get(this.options.api + 'ping', (req:express.Request, res:express.Response) => {
        res.header("Content-Type", "application/json");
        res.send('true');
      })
      .all(table + '/:table/:id', this.handle)
      .all(table + '/:table', this.handle);
    if (this.options.call) {
      console.log(`call is at ${this.options.api}call for ${this.options.call}`);
      this.app.all(this.options.api+'call/:file/:method', (req: express.Request, res: express.Response) => {
        addJbody(req);
        console.log(`${req.method} ${req.url} ${JSON.stringify(req.query)} body: ` + printable(req['jbody']));
        var module1 = require(`${this.options.call}/${req.params.file}.js`);
        this.outputPromise(res, module1[req.params.method](req, res, this));
      });
    }
    if (this.options.www) {
      console.log('static is at:', this.options.www);
      this.app.use(express.static(this.options.www));
    }
    if (this.options.port) {
      console.log('listening at port:', this.options.port);
      this.app.listen(this.options.port);
    }
    if (this.options.custom) {
      console.log('custom is file: ', this.options.custom);
      this.custom = require(this.options.custom);
    }
    if (this.options.raw) {
      console.log('raw is: ', this.options.raw);
      require(this.options.raw)(this);
    }
    this.app.use((err:Error, req: express.Request, res: express.Response, next)=> {
      outputError(err);
      console.log(`timedout: ${req.method} ${req.url} ${JSON.stringify(req.query)} body: ` + printable(req['jbody']));
      res.status(500).send({message: 'request timeout'});
    });
  }

  query = async (sql:string):Promise<any> => {
    console.log('querying: ', sql);
    return new Promise((resolve, reject) => {
      this.conn.query(sql, function (err, rows) {
        if (err) {
          if (err.code == 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' || err.fatal)
            throw err;
          reject(err);
        } else {
          transformRows(rows);
          resolve(rows);
        }
      })
    });
  };
  queryOne = async (sql:string):Promise<any> => {
    var rows = await this.query(sql);
    return rows[0];
  };
  queryColumn = async (sql:string):Promise<any> => {
    var rows:any[] = await this.query(sql);
    return rows.map(getOnlyField);
  };
  queryValue = async (sql:string):Promise<any> => {
    let col = await this.queryColumn(sql);
    return col[0];
  };
  outputResult = (res:express.Response, cont:any, status?:number):void => {
    status = status || 200;
    if (cont.stack) outputError(cont);
    else if (status / 100 != 2) console.log('\n', cont);

    if (typeof cont != 'string') {
      res.header("Content-Type", "application/json");
      cont = JSON.stringify(cont) + '\n';
    }
    if (this.options.verbose || status != 200) {
      let req:express.Request = res['req'];
      console.log(`${req.method} ${req.url} ${JSON.stringify(req.query)} body: ` + printable(req['jbody']));
      console.log(' status: ', status, ' result: ', cont);
    }
    res.status(status).send(cont);
  };
  outputPromise = (res:express.Response, p:Promise<any>):void => {
    p.then((r) => {
      this.outputResult(res, r, 200);
    }, (err)=> {
      if (err instanceof Array) {
        this.outputResult(res, err[0], err[1]);
      } else {
        this.outputResult(res, err, 500);
      }
    });
  };
  handle = (req:express.Request, res:express.Response):void => {
    try {
      addJbody(req);
      console.log(`${req.method} ${req.url} ${JSON.stringify(req.query)} body: ` + printable(req['jbody']));
      var table = req.params.table;
      if ('op_' in req.query && table in this.custom && 'op_' in this.custom[table]) {
        return this.outputPromise(res, this.custom[table].op_(req, res, this));
      }
      if (table in this.custom && req.method in this.custom[table] && !req.query.op_) {
        return this.outputPromise(res, this.custom[table][req.method](req, res, this));
      }
      this.outputPromise(res, this.handleDefault(req));
    } catch (e) {
      this.outputResult(res, e, 500);
    }
  };
  handleDefault = async (req:express.Request):Promise<any> => {
    var table = req.params.table;
    let fs:any[] = await this.query('desc ' + table);
    var tableMeta = {};
    let pris = [];
    for (let k = 0; k < fs.length; k++) {
      let f = fs[k];
      tableMeta[f.Field] = f.Type;
      if (f.Key) {
        pris.push(f.Field);
      }
    }
    let pri = pris.length == 1 ? pris[0] : '';
    if (pri) {
      tableMeta['id_'] = pri;
    }
    var id = req.params.id || null;
    var query = req.query;
    var where = query.where_ || buildCond(id, query, tableMeta);
    where = where && ' where ' + where || '';

    if (req.method == 'GET') {
      let order = query.order_ ? " order by " + query.order_ : "";
      let start = query.start_ || 0;
      let limit = query.limit_ || 100;
      let sql = "select * from " + table + where + order + " limit " + start + "," + limit;
      if (query.op_ == 'count') {
        sql = "select count(1) a from "+table+where;
      }
      let rows:any[] = await this.query(sql);
      if (id && rows.length == 0) {
        return Promise.reject(['', 404]);
      }
      let r:any = rows;
      if (query.op_ == 'count') {
        r = {count: rows[0]['a']};
      } else if (id) {
        r = rows[0];
      }
      return Promise.resolve(r);
    } else if (req.method == 'POST') {
      let jbody = req['jbody'];
      jbody.create_time = jbody.create_time || new Date()['format']();
      jbody.update_time = new Date()['format']();
      let sql = buildUpdate(table, id, jbody, tableMeta, !!req.query.force);
      let result:any = await this.query(sql);
      let nid = id || result.insertId;
      if (!nid) {
        return Promise.resolve(jbody);
      }
      let rows = await this.query(`select * from ${table} where ${pri}='${nid}'`)
      for (let k in rows[0]) {
        if (rows[0].hasOwnProperty(k)) {
          jbody[k] = rows[0][k];
        }
      }
      return Promise.resolve(jbody);
    } else if (req.method == 'DELETE') {
      if (!id && !where) {
        return Promise.reject(['delete should specify condition', 400]);
      }
      let limit = query.limit_ || 1;
      let sql = "delete from " + table + where + ' limit ' + limit;
      let result:any = await this.query(sql);
      if (result.affectedRows == 0) {
        return Promise.reject(['', 404]);
      }
      return Promise.resolve(result);
    }
  };
  genAngular = async (filename: string) => {
    function underscore2Camel(uname) {
      var cname = '';
      var upper = true;
      for (let c of uname) {
        if (c == '_') {
          upper = true;
        } else {
          cname += upper ? c.toUpperCase() : c;
          upper = false;
        }
      }
      console.log('cname is: ', cname);
      return cname;
    }
      var cs = await this.queryColumn(`show tables`);
      var ngCont = "angular.module('restService', ['ngResource'])\n";
      for (let i=0; i<cs.length; i++) {
        let tname = cs[i];
        let fs = await this.query('desc '+tname);
        let pris = [];
        for (let k=0; k<fs.length; k++) {
          let f = fs[k];
          if (f.Key) {
            pris.push(f.Field);
          }
        }
        let camelTable = underscore2Camel(tname);
        let pri = pris.length == 1 ? pris[0] : '';
        var id_part = pri ? ":"+pri+"',{ " + pri + ":'@"+pri+"'}" : "'";
        ngCont += `.factory('${camelTable}', ['$resource',function($resource){ return $resource('${this.options.api}table/${cs[i]}/${id_part});}])\n`;
      }
      require('fs').writeFileSync(filename, ngCont);
      console.log('write result finished:', filename);
      process.exit(0);
  };
}

function quoteValue(value, type) {
  if (value == null) return 'null';
  let qv = util2.mysql_real_escape_string(value);
  return type.search('char') >= 0 || type.search('date') >= 0 ? "'" + qv + "'" : qv;
}

function buildCond(id, query, table) {
  if (id) {
    return " " + table.id_ + "=" + quoteValue(id, table[table.id_]);
  }
  var cond = '';
  for (var f in table) {
    if (table.hasOwnProperty(f) && query.hasOwnProperty(f)) {
      let qf = quoteValue(query[f], table[f]);
      cond += ` and ${f}=${qf}`;
    }
  }
  return cond && cond.slice(4) || '';
}

function buildUpdate(tname, id, jbody, table, force) {
  let fs = [], vs = [], sets = [];
  if (id) { //把id加入update
    jbody[table.id_] = id;
  }
  for (let k in table) {
    if (!table.hasOwnProperty(k) || k == 'id_') continue;
    if (jbody.hasOwnProperty(k) || force) {
      if ((table[k]).search('date') >= 0) {
        jbody[k] = new Date(jbody[k])['format']();
      }
      fs.push(k);
      vs.push(quoteValue(jbody[k] || null, table[k]));
      sets.push(`${k}=${quoteValue(typeof jbody[k] == 'undefined' ? null : jbody[k], table[k])}`);
    }
  }
  let fs2 = fs.join(',');
  let vs2 = vs.join(',');
  let sets2 = sets.join(',');
  return `insert into ${tname}(${fs2}) values(${vs2}) on duplicate key update ${sets2}`;
}

function getOnlyField(obj) {
  return _.values(obj)[0];
}

function transformRows(rows) {
  if (rows instanceof Array) {
    console.log('total rows: ', rows.length);
    for (let i in rows) {
      for (let f in rows[i]) {
        if (rows[i][f] instanceof Date) {
          rows[i][f] = new Date(rows[i][f])['format']();
        }
      }
    }
  }
}

function addJbody(req) {
  if (req.body) {
    req['jbody'] = req.body instanceof Buffer ? JSON.parse(req.body) : req.body;
  }
}

function outputError(err){
  let reg = /\((.*):(.*):.*\)/;
  let matches = err.stack.match(reg);
  if (matches) {
    let file = matches[1];
    let line = parseInt(matches[2]);
    let lns = fs.readFileSync(file).toString('utf8').split('\n', 1000000);
    for(let l=line-4; l<line+5; l++) {
      let sl = l.toString();
      while (sl.length < 5) {
        sl = '0' + sl;
      }
      if (l-1 in lns) console.log(`${l==line?'*':' '}${sl} ${lns[l-1]}`);
    }
  }
  console.error(err.stack);
}

