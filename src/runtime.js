const vm = require("vm");

class Runtime {
	constructor(filename, contextFactory) {
		this.filename = filename;
		this.contextFactory = contextFactory;
		this.code = null;
		this.context = null;
		this.script = null;
	}
	
	async execute(code, event, data) {
		if (this.context == null || code != this.code) {
			this.code = null;
			this.context = null;
			this.script = null;
			
			this.context = this.contextFactory();
			vm.createContext(this.context);
			
			try {
				this.script = new vm.Script(code, { filename: this.filename });
				this.script.runInContext(this.context);
			} catch (error) {
				this.context = null;
				this.script = null;
				console.log("runtime exec script error", error);
				return [error, null];
			}
			
			this.code = code;
		}
		
		if (this.context.hasOwnProperty(event)) {
			try {
				let result = await this.context[event](...data);
				return [null, result];
			} catch (error) {
				this.context = null;
				this.script = null;
				console.log("runtime exec event error", error);
				return [error, null];
			}
		} else {
			return [null, null];
		}
	}
}

module.exports = {
	Runtime,
};
