Object.keys = (Object.keys || (function(o){
  var keys = [];
  for(k in o){
    if(o.hasOwnProperty(k)){
      keys.push(k);
    }
  }
  return keys;
}));

(function(exports, scriptLoader){
	var resolved = [];
	var _modules = {};
	var moduleStore = (function(){
    
    return{
      contains : function(identifier){return !!_modules[identifier]},
      getModule : function(identifier){return _modules[identifier]},
      setModule : function(identifier, module){
        _modules[identifier] = module
      },
      iterator : function(){return Object.keys(_modules)},
      clear : function(){_modules = {}}
    }  
	})()
	
	var require = function(modules, callback){
		if(!modules) return callback();
		
		if(arguments.length<1)
			throw "require called with no arguments"
		
		if(typeof modules==="string"){
			var m = moduleStore.getModule(modules);
			if(m && m.dependenciesResolved){
			  return requireSync(modules);
			} 
			modules = [modules];
		}
		
		var modulePromises = new PromiseList(JSON.stringify(modules));
		for(module in modules){
			modulePromises.add(getModulePromise(modules[module]));
		}

		modulePromises.onFulfill = callback;
	}
	
	require.listModules = function(){
	  return moduleStore.iterator();
	}
	
	require.outstandingPromises = function(){
		return outstandingPromises;
	}
	
	require.resolved = function(){
		return resolved;
	}
	
	require.moduleInfo = function(module){return moduleStore.getModule(module)};
	
	require.reset = function(){
	  moduleStore.clear();
	}
	
	var Promise = function(forModule){
	  this.onFulfill = []
	  this.fulfilled = false;
	  this.moduleIdentifier=forModule;
  };
	Promise.prototype.fulfill = function(promised){
		this.onFulfill.forEach(function(callback){callback(promised)})
		
		delete outstandingPromises[this.moduleIdentifier];
		this.fulfilled = true;
	};
	
	var PromiseList = function(name){
	  this.name = name;
		this.list = [];
	};
	PromiseList.prototype.promiseFulfilled = function(){
		var values = [];
		for(promise in this.list){
			values.push(this.list[promise].value);
			if(!this.list[promise].fulfilled){
				console.log('promiselist for: ' + this.name + ' still waiting for ' + this.list[promise].moduleIdentifier)
				return;
			}
		}
		
		if(typeof this.onFulfill==="function"){
				this.onFulfill.apply(this, values); 
		}
	}
	
	PromiseList.prototype.add = function(promise){
		var self = this;
		this.list.push(promise);
		
		promise.onFulfill.push((function(promised){
			promise.fulfilled = true;
			promise.value = promised;
			self.promiseFulfilled();
		}))
	}
	
	var outstandingPromises = {};
	
	var getModulePromise = function(module){
		if(outstandingPromises[module]) return outstandingPromises[module];
		
		var promise = new Promise(module);
		if(moduleStore.contains(module)){ 
			if(!moduleStore.getModule(module).exports){
				setTimeout(function(){promise.fulfill(evaluateDescriptor(moduleStore.getModule(module)))}, 0);
			}else{
			  setTimeout(function(){promise.fulfill(promise.fulfill(moduleStore.getModule(module).exports))}, 0);  
			}
		}else{
		  console.log("fetching " + module)
			scriptLoader.get(module, function(){
				console.log('got module ' + module)
				if(module === "core"){
					console.log('got core')
				}
				var m = moduleStore.getModule(module);
				if(!m){//non module script required -> it did not pass the require.define entry point. This means we have to manually register it as available for future requires.
					moduleStore.setModule(module, {exports : {}, dependenciesResolved : true});
					setTimeout(function(){
					  promise.fulfill(/* no value handed to callback for non module requires*/);
					},0); 
				}else if(moduleStore.getModule(module).dependenciesResolved){
					console.log('module ' + module + ' has all dependencies resolved')
					setTimeout(function(){
						promise.fulfill(evaluateDescriptor(moduleStore.getModule(module)));
					},0);
				}
				else{
					console.log('wait for dependencies for module ' + module);
					moduleStore.getModule(module).onDependenciesResolved = function(){
						promise.fulfill(evaluateDescriptor(this));
					}
				}
			})
		}
		
		outstandingPromises[module] = promise;
		return promise;
	}
	
	var evaluateDescriptor = function(module){
	  var descriptor = module.descriptor;
		var factory, 
			factoryArgs = { 'require' : requireSync, 'exports' : {}, 'module' : {}}, 
			argArray,
			constructArgArray = function(identifiers){
				var arr = [];
				for(arg in identifiers){
					arr.push(factoryArgs[identifiers[arg]])
				}
				return arr;
			}, 
			defaultArgArray = constructArgArray(['require', 'exports', 'module']);
			
		if(typeof descriptor==="function"){
			factory = descriptor;
			argArray = defaultArgArray;
		}
		else{
		  if(typeof descriptor === "undefined")
		    console.log('module ' + JSON.stringify(module) + ' has no descriptor');
			factory = descriptor["factory"];
			if(!factory)
				throw "No factory method on descriptor object";
			argArray = descriptor.injects ? constructArgArray(descriptor.injects) : defaultArgArray;
		}
		
		factory.apply({}, argArray);

		return module.exports = factoryArgs['exports'];
	}
	
	//The sync version of 'require' used in module definitions. When a module is required by this function it should always be fetched, but might not be evaluated
	var requireSync = function(module){
		if(!moduleStore.contains(module))
			throw "Module " + module + " not available, did you declare it as a dependency?";
		
		var isConstructed = typeof(moduleStore.getModule(module).exports) !== "undefined";
		if(!isConstructed)
			evaluateDescriptor(moduleStore.getModule(module));
			
		return moduleStore.getModule(module).exports;
	}
	
	//entrypoint for modules in Transport/D format
	require.define = function(moduleSet, dependencies){
		for(var identifier in moduleSet){
			console.log('register module definition for ' + identifier);
			//copy all module descriptors to _modules, but do not evaluate them yet
			moduleStore.setModule(identifier, { 
			   identifier : identifier,
			   descriptor: moduleSet[identifier], 
			   dependenciesResolved : !dependencies || dependencies.length===0})
		}
		require(dependencies, function(){
			var exports = {}, module = {};
			for(var identifier in moduleSet){
				resolved.push(identifier)
				moduleStore.getModule(identifier).dependenciesResolved = true;
				if(typeof moduleStore.getModule(identifier).onDependenciesResolved === "function")
					moduleStore.getModule(identifier).onDependenciesResolved(identifier)
			}
		})
	}
	
	exports.require = require;
})(window, { 
			get: function(module, callback){ 
				var head = document.getElementsByTagName('head')[0]
					script = document.createElement('script');
				script.src= (window.requireBasePath || "") + module + '.js';
				script.onload = callback;
				head.appendChild(script);										
			}});	
