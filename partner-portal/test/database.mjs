import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('./schema-snapshot.sql',import.meta.url),'utf8'));
 sql.exec(`CREATE TABLE medicine_inventory(variant_id INTEGER PRIMARY KEY,stock_on_hand INTEGER NOT NULL,reserved INTEGER NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT,first_name TEXT,last_name TEXT);CREATE TABLE user_auth(user_id INTEGER PRIMARY KEY,email_verified INTEGER NOT NULL);CREATE TABLE user_sessions(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,token_hash TEXT UNIQUE,expires_at TEXT,revoked_at TEXT);`);
 class Statement{
  constructor(source,args=[]){this.sql=source;this.args=args;}
  bind(...args){return new Statement(this.sql,args);}
  async first(column){const value=sql.prepare(this.sql).get(...this.args)||null;return column&&value?value[column]:value;}
  async all(){return {results:sql.prepare(this.sql).all(...this.args)}}
  async run(){const statement=sql.prepare(this.sql);if(statement.columns().length){const results=statement.all(...this.args),changes=sql.prepare('SELECT changes() n').get().n;return {success:true,results,meta:{changes:Number(changes)}};}const result=statement.run(...this.args);return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}}
  async raw(){return sql.prepare(this.sql).all(...this.args).map(Object.values)}
 }
 const DB={prepare:q=>new Statement(q),async exec(q){sql.exec(q);return {success:true}},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,DB,close:()=>sql.close()};
}
