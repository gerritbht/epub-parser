var EpubParser;
//var sax = require('./sax');

EpubParser = (function() {
	var jszip = require('node-zip');
	var zip, zipEntries;
	var xml2js = require('xml2js');
	var parser = new xml2js.Parser();
	var request = require('request');
	var fs = require('fs');

	function extractText(filename) {
		var file = zip.file(filename);
		if(typeof file !== 'undefined' || file !== null) {
			return file.asText();
		} else {
			throw 'file '+filename+' not found in zip';
		}
	}

	function extractBinary(filename) {
		var file = zip.file(filename);
		if(typeof file !== 'undefined') {
			return file.asBinary();
		} else {
			return '';
		}
	}

	function open(filename, cb) {
		/*
		var zipfile = require('zipfile');
		var zf = new zipfile.ZipFile(filename);
		
		zf.readFile('META-INF/container.xml', function (err, data) {
			console.log('zf:');
			console.log(data);
		});	
		*/

		var epubdata = {};
		var md5hash;
		var htmlNav = '<ul>';
		var container,
			opf, 
			ncx,
			opfPath,
			ncxPath,
			navPath,
			opsRoot,
			uniqueIdentifier,
			uniqueIdentifierValue,
			uniqueIdentifierScheme = null, 
			opfDataXML,
			ncxDataXML,
			opfPrefix = '',
			dcPrefix = '',
			ncxPrefix = '',
			metadata,
			manifest,
			spine,
			guide,
			nav,
			root,
			ns,
			ncxId,
			epub3CoverId,
			epub3NavId,
			epub3NavHtml,
			epub2CoverUrl = null,
			isEpub3,
			epubVersion;
		var itemlist, itemreflist;
		var itemHashById = {};
		var itemHashByHref = {};
		var linearSpine = {};
		var spineOrder = [];
		var simpleMeta = [];

		function readAndParseData(/* Buffer */ data, cb) {
			md5hash = require('crypto').createHash('md5').update(data).digest("hex");
			try {
				zip = new jszip(data.toString('binary'), {binary:true, base64: false, checkCRC32: true});
				var containerData = extractText('META-INF/container.xml');
				parseEpub(containerData, function (err,epubData) {
					if(err) return cb(err);
					cb(null,epubData);
				});
			} catch(e) {
				cb(e);
			}
		}
		
		function parseEpub(containerDataXML, finalCallback) {
		  /*
		    Parsing chain walking down the metadata of an epub,
		    and storing it in the JSON config object
		  */
			parser.parseString(containerDataXML, function (err, containerJSON) {
			parseContainer(err, containerJSON, finalCallback);
		  	});
		}

		function parseContainer(err, containerJSON, finalCallback) {

			  var cb = finalCallback;

		      if(err) return cb(err);
		      container = containerJSON.container;

		      // determine location of OPF
		      opfPath = root = container.rootfiles[0].rootfile[0]["$"]["full-path"];

		      // set the opsRoot for resolving paths
		      if(root.match(/\//)) { // not at top level
 		      	opsRoot = root.replace(/\/([^\/]+)\.opf/i, '');
 		      	if(!opsRoot.match(/\/$/)) { // does not end in slash, but we want it to
 		      		opsRoot += '/';
 		      	}
 		      	if(opsRoot.match(/^\//)) {
 		      		opsRoot = opsRoot.replace(/^\//, '');
 		      	}
		      } else { // at top level
		      	opsRoot = '';
		      }

		      //console.log('opsRoot is:'+opsRoot+' (derived from '+root+')');

		      // get the OPF data and parse it
		      opfDataXML = extractText(root);

		      parser.parseString(opfDataXML.toString(), function (err, opfJSON) {
		          if(err) return cb(err);
		          // store opf data
		          opf = (opfJSON["opf:package"]) ? opfJSON["opf:package"] : opfJSON["package"];
		          uniqueIdentifier = opf["$"]["unique-identifier"];
		          epubVersion = opf["$"]["version"][0];

		          isEpub3 = (epubVersion=='3'||epubVersion=='3.0') ? true : false;
		          
		          //console.log('epub version:'+epubVersion);

				  for(att in opf["$"]) {
				  	if(att.match(/^xmlns\:/)) {
				  		ns = att.replace(/^xmlns\:/,'');
				  		if(opf["$"][att]=='http://www.idpf.org/2007/opf') opfPrefix = ns+':';
				  		if(opf["$"][att]=='http://purl.org/dc/elements/1.1/') dcPrefix = ns+':';
				  	}
				  }

				  parsePackageElements();

				  // spine


					itemlist = manifest[opfPrefix+"item"];
					itemreflist = spine[opfPrefix+"itemref"];
					buildItemHashes();
					buildLinearSpine();

				  // metadata

				  buildMetadataLists();

				  /* This whole section needs to be reordered since epPub 3 CAN have an NCX for downward compatibility, so the presence of an ncx does NOT
				  	automatically mean that it is an epub 2 document. Thus the order is now rearranged */

			  	if (!ncxId && !isEpub3) {
			  		cb(new Error("Neither ePub 3 nor an NCX document, aborting"));
			  	}
			  	if (isEpub3) {
			  		console.log("Epub 3");
			  		ncxDataXML = '';
			  		ncxPath = '';
			  		htmlNav = null;
			  		if (!epub3NavHtml) {
			  			cb(new Error("ePub 3 Document with no navigation Document"));
			  		}
			  		parser.parseString(epub3NavHtml, function (err, navJSON) {
			  			if (err) return cb(err);
			  			nav = navJSON;
			  			epubdata = getEpubDataBlock();
			  			cb(null, epubdata);
			  		});
			  	}
			  	if (ncxId && !isEpub3) {
	      	  		for(item in manifest[opfPrefix+"item"]) {
            			if(manifest[opfPrefix+"item"][item]["$"].id==ncxId) {
              				ncxPath = opsRoot + manifest[opfPrefix+"item"][item]["$"].href;
	            		}
	          		}
	          		ncxDataXML = extractText(ncxPath);
	          		parser.parseString(ncxDataXML.toString(), function (err, ncxJSON) {
	        			if(err) return cb(err);
        				ncx = ncxJSON[ncxPrefix+"ncx"];
						var navPoints = ncx[ncxPrefix+"navMap"][0].navPoint;
						for(var i = 0; i < navPoints.length; i++) {
							processNavPoint(navPoints[i]);
						}
						htmlNav += '</ul>'+"\n";
	  					epubdata = getEpubDataBlock();
			        	cb(null,epubdata);
	          		});
			  	}
		   });
		}

		function processNavPoint(np) {
			var text = 'Untitled';
			var src = "#";
			if(typeof np.navLabel !== 'undefined') {
				text = np.navLabel[0].text[0];
			}
			if(typeof np.content !== 'undefined') {
				src = np.content[0]["$"].src;
			}
			htmlNav += '<li><a href="'+src+'">'+text+'</a>';
			if(typeof np.navPoint !== 'undefined') {
				htmlNav += '<ul>';
				for(var i = 0; i < np.navPoint.length; i++) {
					processNavPoint(np.navPoint[i]);
				}
				htmlNav += '</ul>'+"\n";
			}
			htmlNav += '</li>'+"\n";
		}

		function buildItemHashes() {
			for(item in itemlist) {
				var href = itemlist[item].$.href;
				var id = itemlist[item].$.id;
				var mediaType = itemlist[item].$['media-type'];
				var properties = itemlist[item].$['properties'];
				if(typeof properties !== 'undefined') {
					if(properties == 'cover-image') {
						epub3CoverId = id;
					} else if (properties == 'nav') {
						epub3NavId = id;
						epub3NavHtml = extractText(opsRoot+href);
						navPath = opsRoot + href.substr(0, href.indexOf('\/')+1); //Store path of the navigation document, since paths in it are relative to here
					}
				}
				itemHashByHref[href] = itemlist[item];
				itemHashById[id] = itemlist[item];
			}
			var itemrefs = itemreflist;
		  	try {
				ncxId = spine.$.toc;
			} catch(e) {
				;
			}
		}

		function buildLinearSpine() {
			for(itemref in itemreflist) {
				var id = itemreflist[itemref].$.idref;

				spineOrder.push(itemreflist[itemref].$);

				if(itemreflist[itemref].$.linear=='yes' || typeof itemreflist[itemref].$.linear == 'undefined') {
					itemreflist[itemref].$.item = itemHashById[id];
					linearSpine[id] = itemreflist[itemref].$;
				}
			}
		}

		function buildMetadataLists() {
			var metas = metadata;
			for(prop in metas) {		
				if(prop == 'meta') { // process a list of meta tags
					console.log("debug->parser->processing META tags");
					for(var i = 0; i < metas[prop].length; i++) {
						var m = metas[prop][i].$;
						if(typeof m.name !== 'undefined') {
							var md = {};
							md[m.name] = m.content;
							simpleMeta.push(md);
						} else if (typeof m.property !== 'undefined') {
							var md = {};
							md[m.property] = metas[prop][i]._;
							simpleMeta.push(md);
						}
						if(m.name == 'cover') {
							if (typeof itemHashById[m.content] !== 'undefined') {
								epub2CoverUrl = opsRoot + itemHashById[m.content].$.href;
							}
						}
					}
				} else if(prop != '$') {
					var content = '';
					var atts = {};
					if(metas[prop][0]) {
						if(metas[prop][0].$ || metas[prop][0]._) { // complex tag
							content = (metas[prop][0]._) ?
								metas[prop][0]._ :
								metas[prop][0];

							if(metas[prop][0].$) { // has attributes
								for(att in metas[prop][0].$) {
									atts[att]=metas[prop][0].$[att];
								}
							}
						} else { // simple one, if object, assume empty
							content = (typeof metas[prop][0] == 'object') ? '' : metas[prop][0];
						}
					}
					if(typeof prop !== 'undefined') {
						var md = {};
						md[prop] = content;
						simpleMeta.push(md);
					}
					if(prop.match(/identifier$/i)) {
						if(typeof metas[prop][0].$.id) {
							if(metas[prop][0].$.id==uniqueIdentifier) {
								if(typeof content == 'object') {
									console.log('warning - content not fully parsed');
									console.log(content);
									console.log(metas[prop][0].$.id);
								} else {
									uniqueIdentifierValue = content;
									if(typeof metas[prop][0].$.scheme !== 'undefined') {
										uniqueIdentifierScheme= metas[prop][0].$.scheme;
									}								
								}
							}
						};
					}
				}
			}
		}

		function parsePackageElements() {
		  
		  // operates on global vars

		  /* 
		  Not completely standard conform, older publications use another declaration with optional <dc-metadata> and <x-metadata>:
		  http://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm#Section2.1
		  */

		  /* For project guttenberg ebooks the opfPrefix is screwed up, they define the opfPrefix but then don't use it,
					which gets us errors because of undefined attributes - so this is my workaround */

		  if (!opf[opfPrefix+"manifest"]) {
		  	opfPrefix = '';
		  }

		  try {
			  metadata = opf[opfPrefix+"metadata"][0];
		  } catch(e) {
		  	  console.log('metadata element error: '+e.message);
		  }
		  try {
			  manifest = opf[opfPrefix+"manifest"][0];
		  } catch (e) {
		  	  console.log('manifest element error: '+e.message);
		  	  //console.log('PARSER must throw this');
		  	  throw (e);
		  }
		  try {
			  spine = opf[opfPrefix+"spine"][0];
		  } catch(e) {
			  console.log('spine element error: '+e.message);
			  //console.log('PARSER must throw this');
		  	  throw (e);
		  }
		  try {
			  guide = opf[opfPrefix+"guide"][0];
		  } catch (e) {
		  	  ;
		  }
		}

		function getEpubDataBlock()
		{
			return {
				easy: {
					primaryID: {
						name:uniqueIdentifier,
						value:uniqueIdentifierValue,
						scheme:uniqueIdentifierScheme 
					},
					epubVersion: epubVersion,
					isEpub3: isEpub3,
					md5: md5hash,
					epub3NavHtml: epub3NavHtml,
					navMapHTML: htmlNav,
					linearSpine: linearSpine,
					itemHashById: itemHashById, 
					itemHashByHref: itemHashByHref, 
					linearSpine: linearSpine,
					simpleMeta: simpleMeta,
					epub3CoverId: epub3CoverId,
					epub3NavId: epub3NavId,
					epub2CoverUrl: epub2CoverUrl
				},
				paths: {
					opfPath: opfPath,
					ncxPath: ncxPath,
					opsRoot: opsRoot,
					navPath: navPath
				},
				raw: {
					json: {
						prefixes: {
							opfPrefix:opfPrefix,
							dcPrefix:dcPrefix,
							ncxPrefix:ncxPrefix
						},
						container: container,
						opf: opf,
						ncx: ncx,
						nav: nav
					},
					xml: {
						opfXML: opfDataXML,
						ncxXML: ncxDataXML
					}
				}
	  	};
		}

		if(filename.match(/^https?:\/\//i)) { // is a URL
			request({
			    uri:filename,
			    encoding:null /* sets the response to be a buffer */
				}, function (error, response, body) {
			        if (!error && response.statusCode == 200) {
			          var b = body;
					  readAndParseData(b, cb);
			        } else {
			          cb(new Error("Bad response from remote server"),null);
			        }        
				});
		} else { // assume local full path to file
			fs.readFile(filename, 'binary', function (err, data) {
				if(err) return cb(err);
				readAndParseData(data, cb);
			});
		}
	} // end #open function definition block
	return {
		open:open,
		getZip:function () { return zip; },
		getJsZip: function () { return jszip; },
		extractBinary: extractBinary,
		extractText: extractText
	};
})();
module.exports = EpubParser;