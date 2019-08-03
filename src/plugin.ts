const through2 = require('through2')
import Vinyl = require('vinyl')
import PluginError = require('plugin-error');
const pkginfo = require('pkginfo')(module); // project package.json info into module.exports
const PLUGIN_NAME = module.exports.name;
import * as loglevel from 'loglevel'
const log = loglevel.getLogger(PLUGIN_NAME) // get a logger instance based on the project name
log.setLevel((process.env.DEBUG_LEVEL || 'warn') as log.LogLevelDesc)

import * as mailparser from 'mailparser'
var sp = mailparser.simpleParser // higher-level parser (easier to use, not as efficient)
var string_to_strm = require('string-to-stream')
import replaceExt = require('replace-ext')


/** wrap incoming recordObject in a Singer RECORD Message object*/
function createRecord(recordObject:Object, streamName: string) : any {
  return {type:"RECORD", stream:streamName, record:recordObject}
}

/* This is a gulp-etl plugin. It is compliant with best practices for Gulp plugins (see
https://github.com/gulpjs/gulp/blob/master/docs/writing-a-plugin/guidelines.md#what-does-a-good-plugin-look-like ),
and like all gulp-etl plugins it accepts a configObj as its first parameter */
export function tapMime(configObj: {keepCidLinks ?: boolean, ResendableJSON ?: boolean, ExtractAttachments ?: boolean}) {
  if (!configObj) configObj = {}
  let keepCidLinks: boolean | undefined = (configObj.keepCidLinks !== null)? configObj.keepCidLinks : undefined
  let ResendableJSON: boolean | undefined = (configObj.ResendableJSON !== null)? configObj.ResendableJSON : false
  let ExtractAttachments: boolean | undefined = (configObj.ExtractAttachments !== null) ? configObj.ExtractAttachments : true

  // creating a stream through which each file will pass - a new instance will be created and invoked for each file 
  // see https://stackoverflow.com/a/52432089/5578474 for a note on the "this" param
const strm = through2.obj(
  async function (this: any, file: Vinyl, encoding: string, cb: Function) {
    let returnErr: any = null
    const self = this

    function convertor(MailObject:any) {
      //for headers
        MailObject.headers = MailObject.headerLines
        delete MailObject.headerLines
        for (var i = 0; i < MailObject.headers.length; i++) {
          //MailObject.headers[i].key = ""
          var index = MailObject.headers[i].line.indexOf(":");
          var NewKeyValue = MailObject.headers[i].line.slice(0,index)
          MailObject.headers[i].key = NewKeyValue
          MailObject.headers[i].line = MailObject.headers[i].line.slice(index+2,)
          MailObject.headers[i].value = MailObject.headers[i].line
          delete MailObject.headers[i].line
        }
        //for attachments
        let attachmentIdx = Object.keys(MailObject).indexOf("attachments")
        if(attachmentIdx > -1 && MailObject.attachments.length > 0) {
          for(var i = 0; i < MailObject.attachments.length; i++) {
            MailObject.attachments[i].content = MailObject.attachments[i].content
          }
        }
        
        
  
      //for from 
      if(MailObject.from)
        MailObject.from = MailObject.from.value
        
      //for to
      if(MailObject.to)
        MailObject.to = MailObject.to.value
      }
  
    function extractAttachments (attachments:any,stream:any) {
      if(attachments.length > 0){
        if(Array.isArray(attachments)) {
          for(var i = 0; i < attachments.length; i++) {
            stream.push(new Vinyl({
              path: attachments[i].filename,
              contents: attachments[i].content
            }))
          } 
        }
        else if(attachments) {
          stream.push(new Vinyl({
            path: attachments.filename,
            contents: attachments.content
          }))
        }
      }
    }

    if (file.isNull()) {
      // return empty file
      return cb(returnErr, file)
    }

    else if (file.isBuffer()) {
      let parsed:any
      if(keepCidLinks) {
        parsed = await sp(file.contents, {keepCidLinks: keepCidLinks})
      }
      else{
        parsed = await sp(file.contents)
      }
      
      let parsedMail = createRecord(parsed, "TapMimeBufferMode")
      if(ResendableJSON) {
        convertor(parsedMail.record)
      }

      if(ExtractAttachments) {
        extractAttachments(parsedMail.record.attachments, self)
        parsedMail.record.attachments = []
      }
      file.contents = Buffer.from(JSON.stringify(parsedMail))
      file.path = replaceExt(file.path, '.JSON')
      // we are done with file processing. Pass the processed file along
      log.debug('calling callback')    
      cb(returnErr, file);    
    }

    else if (file.isStream()) {
      let parsed:any
      if(keepCidLinks) {
        parsed = await sp(file.contents, {keepCidLinks: keepCidLinks})
      }
      else{
        parsed = await sp(file.contents)
      }
      let parsedMail = createRecord(parsed, "TapMimeStreamMode")

      if(ResendableJSON) {
        convertor(parsedMail.record)
      }
      if(ExtractAttachments) {
        extractAttachments(parsedMail.record.attachments, self)
        parsedMail.record.attachments = []
      }
      file.contents = string_to_strm(JSON.stringify(parsedMail))
      file.path = replaceExt(file.path, '.JSON')
      // we are done with file processing. Pass the processed file along
      log.debug('calling callback')    
      cb(returnErr, file);
    }
    
  })

  return strm
}