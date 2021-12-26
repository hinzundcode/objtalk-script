const WebSocket = require("ws");
const EventEmitter = require("events");
const { RpcClient } = require("./rpc.js");

function panic() {
	console.log("disconnected");
	process.exit(1);
}

class Connection {
	constructor(url) {
		this.url = url;
		this.queries = {};
	}
	
	async connect() {
		this.ws = new WebSocket(this.url);
		this.ws.on("close", panic);
		this.ws.on("end", panic);
		this.ws.on("error", panic);
		
		await new Promise(resolve => this.ws.once("open", resolve));
		
		this.client = new RpcClient(msg => this.ws.send(JSON.stringify(msg)));
		this.ws.on("message", msg => this.client.onMessage(JSON.parse(msg)));
		this.ws.on("message", msg => {
			msg = JSON.parse(msg);
			
			if (msg.type == "queryAdd") {
				let query = this.queries[msg.queryId];
				if (query) query.onAdd(msg.object);
			} else if (msg.type == "queryChange") {
				let query = this.queries[msg.queryId];
				if (query) query.onChange(msg.object);
			} else if (msg.type == "queryRemove") {
				let query = this.queries[msg.queryId];
				if (query) query.onRemove(msg.object);
			} else if (msg.type == "queryEvent") {
				let query = this.queries[msg.queryId];
				if (query) query.onEvent(msg);
			}
		});
	}
	
	async get(pattern) {
		let response = await this.client.request({ type: "get", pattern });
		return Object.fromEntries(response.objects.map(object => [object.name, object]));
	}
	
	set(name, value) {
		return this.client.request({ type: "set", name, value });
	}
	
	patch(name, value) {
		return this.client.request({ type: "patch", name, value });
	}
	
	async remove(name) {
		let { existed } = await this.client.request({ type: "remove", name });
		return existed;
	}
	
	emit(object, event, data) {
		return this.client.request({ type: "emit", object, event, data });
	}
	
	async query(pattern) {
		let response = await this.client.request({ type: "query", pattern });
		let query = new Query(response.queryId, response.objects);
		this.queries[response.queryId] = query;
		return query;
	}
	
	async stopQuery(query) {
		delete this.queries[query.queryId];
		await this.client.request({ type: "unsubscribe", queryId: query.queryId });
	}
}

class Query extends EventEmitter {
	constructor(queryId, objects) {
		super();
		
		this.queryId = queryId;
		this.objects = Object.fromEntries(objects.map(object => [object.name, object]));
	}
	
	onAdd(object) {
		this.objects[object.name] = object;
		this.emit("add", object);
		this.emit("update", this.objects);
	}
	
	onChange(object) {
		this.objects[object.name] = object;
		this.emit("change", object);
		this.emit("update", this.objects);
	}
	
	onRemove(object) {
		delete this.objects[object.name];
		this.emit("remove", object);
		this.emit("update", this.objects);
	}
	
	onEvent({ object, event, data }) {
		this.emit("event", { object, event, data });
	}
}

module.exports = {
	Connection,
};
