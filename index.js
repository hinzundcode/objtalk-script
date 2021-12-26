const { Connection } = require("./src/objtalk.js");
const { Synchronize } = require("./src/sync.js");
const { Runtime } = require("./src/runtime.js");

function clone(x) {
	return JSON.parse(JSON.stringify(x));
}

function parseStack(text) {
	let lines = text.split("\n");
	
	let stackStart = null;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].match(/^\s*at /)) {
			stackStart = i;
			break;
		}
	}
	
	if (stackStart === null)
		return { message: text, stack: null };
	
	let message = lines[stackStart-1];
	
	let stack = lines.slice(stackStart).map(line => {
		let match = line.match(/^\s*at (?<function>[^ ]+) \((?<filename>.*):(?<line>\d+):(?<column>\d+)\)$/);
		if (match) return {
			"function": match.groups.function,
			filename: match.groups.filename,
			line: parseInt(match.groups.line),
			column: parseInt(match.groups.column),
		};
		
		match = line.match(/^\s*at (?<filename>.*):(?<line>\d+):(?<column>\d+)$/);
		if (match) return {
			filename: match.groups.filename,
			line: parseInt(match.groups.line),
			column: parseInt(match.groups.column),
		};
		
		return {};
	});
	
	return { message, stack };
}

function filterStack(stack, filenames) {
	for (let i = 0; i < stack.length; i++) {
		if (!stack[i].filename || !filenames.includes(stack[i].filename))
			return stack.slice(0, i);
	}
	
	return stack;
}

function createContext(conn, workerLog) {
	return {
		console: {
			log(...message) {
				workerLog("console.log", { message, stack: filterStack(parseStack(new Error().stack).stack.slice(1), ["<listener>"]) });
			},
			error(...message) {
				workerLog("console.error", { message, stack: filterStack(parseStack(new Error().stack).stack.slice(1), ["<listener>"]) });
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
		this.runtime = new Runtime("<listener>", () => createContext(client, this.log.bind(this)));
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
			if (error != null) {
				if (error.hasOwnProperty("stack")) {
					let { message, stack } = parseStack(error.stack);
					this.log("error", { error: message, stack: filterStack(stack, ["<listener>"]) });
				} else {
					this.log("error", { error: ""+error });
				}
			}
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
