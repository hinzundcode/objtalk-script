class Synchronize {
	constructor() {
		this.promises = [];
		this.executingPromise = false;
	}
	
	do(promise) {
		if (this.executingPromise) {
			this.promises.push(promise);
		} else {
			this.executingPromise = true;
			setImmediate(() => promise().then(this.done.bind(this)));
		}
	}
	
	done() {
		if (this.promises.length == 0) {
			this.executingPromise = false;
		} else {
			let next = this.promises.shift();
			setImmediate(() => next().then(this.done.bind(this)));
		}
	}
}

module.exports = {
	Synchronize
};
