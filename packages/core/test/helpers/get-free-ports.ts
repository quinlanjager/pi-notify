import net from "node:net";

function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address() as net.AddressInfo;
			srv.close(() => resolve(addr.port));
		});
		srv.on("error", reject);
	});
}

export async function getFreePorts(n: number): Promise<number[]> {
	const ports: number[] = [];
	for (let i = 0; i < n; i++) {
		ports.push(await getFreePort());
	}
	return ports;
}
