class RpcClient {
	constructor(send) {
		this.nextRequestId = 1;
		this.requests = {};
		this.send = send;
	}
	
	onMessage(msg) {
		if (msg.hasOwnProperty("requestId")) {
			if (this.requests.hasOwnProperty(msg.requestId)) {
				let { resolve, reject } = this.requests[msg.requestId];
				delete this.requests[msg.requestId];
				
				if ("error" in msg)
					reject(msg.error);
				else
					resolve(msg.result);
			}
		}
	}
	
	request(msg) {
		return new Promise((resolve, reject) => {
			let requestId = this.nextRequestId++;
			this.requests[requestId] = { resolve, reject };
			this.send({ id: requestId, ...msg });
		});
	}
}

module.exports = {
	RpcClient,
};
