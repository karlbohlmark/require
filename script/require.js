(function(exports, scriptLoader){
	var _modules = {};
	
	var require = function(modules, callback){
		if(arguments.length<1)
			throw "require called with no arguments"
		
		if(typeof modules==="string")
			modules = [modules];
		
		var modulePromises = new PromiseList();
		for(module in modules){
			modulePromises.add(getModulePromise(modules[module]));
		}
		modulePromises.onFulfill = callback;
	}
	
	var Promise = function(){this.fulfilled = false;};
	Promise.prototype.fulfill = function(promised){
		if(typeof this.onFulfill==="function")
			this.onFulfill(promised);
		this.fulfilled = true;
	};
	
	var PromiseList = function(){
		this.list = [];
	};
	PromiseList.prototype.promiseFulfilled = function(){
		var values = [];
		for(promise in this.list){
			values.push(this.list[promise].value);
			if(!this.list[promise].fulfilled)
				return;
		}
		
		if(typeof this.onFulfill==="function"){
				this.onFulfill.apply(this, values); 
		}
	}
	
	PromiseList.prototype.add = function(promise){
		var self = this;
		this.list.push(promise);
		
		promise.onFulfill = function(promised){
			promise.fulfilled = true;
			promise.value = promised;
			self.promiseFulfilled();
		}
	}
	
	var notifyScriptProvided = function(scriptPath){
		_modules.forEach(function(m){
			if(m.dependenciesResolved) return;
			if(m.dependencies){
				m.dependencies.forEach(function(d){
					if(d===scriptPath){
						
					}
				})
			}
		})
	}
	
	var getModulePromise = function(module){
		var promise = new Promise();
		if(module in _modules){ //No callback provided and module already loaded -> 
			if(!_modules[module].exports){
				evaluateDescriptor(_modules[module].descriptor);
				return; //Make sure undefined is returned anyway so noone gets the idea that this call is sync.
			}
		}else{
			scriptLoader.get(module, function(){
				console.log('got module ' + module)
				if(!_modules[module]){//non module script required -> it did not pass the require.define entry point. This means we have to manually register it as available for future requires.
					_modules[module] = {exports : {}, dependenciesResolved : true};
					promise.fulfill(/* no value handed to callback for non module requires*/);
				}else if(_modules[module].dependenciesResolved){
					console.log('module ' + module + ' has all dependencies resolved')
					promise.fulfill(evaluateDescriptor(_modules[module].descriptor));
				}
				else{
					console.log('wait for dependencies for module ' + module);
					_modules[module].onDependenciesResolved = function(){
						promise.fulfill(evaluateDescriptor(this.descriptor));
					}
				}
			})
		}
		return promise;
	}
	
	var evaluateDescriptor = function(descriptor){
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
			factory = descriptor["factory"];
			if(!factory)
				throw "No factory method on descriptor object";
			argArray = descriptor.injects ? constructArgArray(descriptor.injects) : defaultArgArray;
		}
		
		factory.apply({}, argArray);
		
		return factoryArgs['exports'];
	}
	
	//The sync version of 'require' used in module definitions. When a module is required by this function it should always be fetched, but might not be evaluated
	var requireSync = function(module){
		if(!(module in _modules))
			throw "Module " + module + " not available, did you declare it as a dependency?";
		
		if(!_modules[module].exports)
			_modules[module].exports = evaluateDescriptor(_modules[module].descriptor);
			
		return _modules[module].exports;
	}
	
	//entrypoint for modules in Transport/D format
	require.define = function(moduleSet, dependencies){
		for(var identifier in moduleSet){
			console.log('register module definition for ' + identifier);
			//copy all module descriptors to _modules, but do not evaluate them yet
			_modules[identifier] = { descriptor: moduleSet[identifier], initialized: false, dependenciesResolved : !dependencies || dependencies.length===0}
		}
		require(dependencies, function(){
			var exports = {}, module = {};
			for(var identifier in moduleSet){
					_modules[identifier].dependenciesResolved = true;
					if(typeof _modules[identifier].onDependenciesResolved === "function")
						_modules[identifier].onDependenciesResolved(identifier)
			}
		})
	}
	
	exports.require = require;
})(window,  { 
			get: function(module, callback){ 
				var head = document.getElementsByTagName('head')[0]
					script = document.createElement('script');
				script.src='/script/' + module;
				script.onload = callback;
				head.appendChild(script);										
			}});	