'use strict';

var api = '/api/';
var table = api+'table/';
var rest = require('../js/rest-mysql').create({
  api,
  custom: __dirname + '/../hlp/custom.js',
  raw: __dirname + '/../hlp/raw.js',
  port: 0,
});

var request = require('supertest')(rest.app);
var expect = require('chai').expect;

describe('mysql test', ()=> {
  it('select 1 query should be ok', ()=> {
    return rest.query('select 1').then((data)=> {
      console.log('data: ', data);
      expect(data[0]['1']).to.equal(1);
    });
  });
  it('select now query should be ok', ()=> {
    return rest.queryValue('select now()').then((data)=> {
      console.log('data: ', data);
      expect(data.length).to.equal('YYYY-MM-DD hh:mm:ss'.length);
    });
  });
  it('execute sql should be ok', (done) => {
    rest.query('drop table if exists t').then(()=> {
      done();
    });
  });
  it('execute sql should be ok', (done) => {
    rest.query('create table t(id int(11) auto_increment primary key, v1 int(11))').then(()=> {
      done();
    });
  });
});
describe('rest ', () => {
  it('ping should be ok', (done)=> {
    request.get(api+'ping')
      .expect(200)
      .end(done);
  });

  it('post no id should be ok', (done)=>{
    request.post(table+'t')
      .send({v1: '2'})
      .expect(200)
      .end(done);
  });
  it('post id should be ok', (done)=>{
    request.post(table+'t')
      .send({id: 3, v1: '3'})
      .expect(200)
      .end(done);
  });
  it('query by id should be ok', (done)=> {
    request.get(table+'t/3')
      .expect(200)
      .end(done);
  });
  it('delete by id should be ok', (done)=> {
    request.delete(table+'t/3')
      .expect(200)
      .end(done);
  });
  it('query none should be 404', (done) => {
    request.get(table+'t/3')
      .expect(404)
      .end(done);
  });
  it('query all should be ok', (done) => {
    request.get(table+'t')
      .expect(200)
      .end(done);
  });
  it('query custom should be ok', ()=>{
    return request.get(table+'t2')
      .expect((res) => {
        expect(res.body).to.equal(true);
      });
  });
  it('query raw should be ok', ()=>{
    return request.get(api+'raw')
      .expect((res) => {
        expect(res.body).to.equal(true);
      });
  });
});