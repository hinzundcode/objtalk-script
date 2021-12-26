const { Connection } = require("./src/objtalk.js");
const { Synchronize } = require("./src/sync.js");
const { Runtime } = require("./src/runtime.js");

function clone(x) {
	return JSON.parse(JSON.stringify(x));
}

function createContext(conn, workerLog) {
	return {
		console: {
			log(...message) {
				workerLog("console.log", { message });
			},
			error(...message) {
				workerLog("console.error", { message });
			},
		},
		async get(pattern) {
			return await conn.get(pattern);
		},
		async set(name, value) {
			return await conn.set(name, value);
		},
		async patch(name, value) {
			return await conn.patch(name, value);
		},
		async remove(name) {
			return await conn.remove(name);
		},
		async emit(object, event, data) {
			return await conn.emit(object, event, data);
		},
	};
}

let client;
let listeners = {};

class Listener {
	constructor(object, query) {
		this.object = object;
		this.query = query;
		this.runtime = new Runtime(() => createContext(client, this.log.bind(this)));
		this.synchronize = new Synchronize();
		
		this.enqueueEvent("onStart", this.query.objects);
		this.query.on("update", () => this.enqueueEvent("onUpdate", this.query.objects));
		this.query.on("add", object => this.enqueueEvent("onAdd", object, this.query.objects));
		this.query.on("change", object => this.enqueueEvent("onChange", object, this.query.objects));
		this.query.on("remove", object => this.enqueueEvent("onRemove", object, this.query.objects));
		this.query.on("event", ({ object, event, data }) => this.enqueueEvent("onEvent", this.query.objects[object], event, data, this.query.objects));
	}
	
	enqueueEvent(event, ...data) {
		console.log("enqueue event", this.object.name, event);
		let code = this.object.value.code;
		let dataClone = clone(data);
		this.synchronize.do(async () => {
			console.log("execute event", this.object.name, event);
			let [error, result] = await this.runtime.execute(code, event, dataClone);
			if (error != null)
				this.log("error", { error: ""+(error.stack ? error.stack : error) });
		});
	}
	
	log(type, data) {
		console.log(this.object.name, type, data);
		client.emit(this.object.name, type, data);
	}
}

async function addListener(object) {
	console.log("add listener", object.name);
	let query = await client.query(object.value.pattern);
	listeners[object.name] = new Listener(object, query);
}

async function removeListener(object) {
	console.log("remove listener", object.name);
	await client.stopQuery(listeners[object.name].query);
	delete listeners[object.name];
}

function ping() {
	let timeout = setTimeout(() => {
		console.error("ping timeout!");
		process.exit(1);
	}, 5000);
	client.get("ping")
		.then(result => clearTimeout(timeout));
}

(async () => {
	if (process.argv.length < 3) {
		console.error("usage: node index.js <objtalk-ws-url>");
		process.exit(1);
	}
	
	let url = process.argv[2];
	
	client = new Connection(url);
	await client.connect();
	console.log("connected");
	
	let synchronize = new Synchronize();
	
	let query = await client.query("listener/*");
	for (let object of Object.values(query.objects))
		synchronize.do(() => addListener(object));
	query.on("add", object =>
		synchronize.do(() => addListener(object)));
	query.on("change", object => {
		synchronize.do(() => removeListener(object));
		synchronize.do(() => addListener(object));
	});
	query.on("remove", object =>
		synchronize.do(() => removeListener(object)));
	
	setInterval(ping, 10000);
})();
