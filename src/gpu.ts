import type { GpuAdapter, GpuComputeJob } from "./types";

type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter(): Promise<unknown>;
  };
};

const GPU_BUFFER_USAGE = {
  MAP_READ: 1,
  COPY_SRC: 4,
  COPY_DST: 8,
  STORAGE: 128
};

const GPU_MAP_MODE = {
  READ: 1
};

function getGpuConstants() {
  const root = globalThis as typeof globalThis & {
    GPUBufferUsage?: typeof GPU_BUFFER_USAGE;
    GPUMapMode?: typeof GPU_MAP_MODE;
  };
  return {
    bufferUsage: root.GPUBufferUsage ?? GPU_BUFFER_USAGE,
    mapMode: root.GPUMapMode ?? GPU_MAP_MODE
  };
}

export function supportsWebGPU(nav: NavigatorWithGpu | undefined = globalThis.navigator as NavigatorWithGpu): boolean {
  return Boolean(nav?.gpu?.requestAdapter);
}

export async function createGpuAdapter(
  nav: NavigatorWithGpu | undefined = globalThis.navigator as NavigatorWithGpu
): Promise<GpuAdapter | null> {
  if (!supportsWebGPU(nav)) {
    return null;
  }

  const adapter = await nav?.gpu?.requestAdapter();
  if (!adapter) {
    return null;
  }

  const device = await (adapter as { requestDevice(): Promise<any> }).requestDevice();
  const constants = getGpuConstants();

  return {
    supported: true,
    async runCompute(job: GpuComputeJob): Promise<ArrayBuffer> {
      const module = device.createShaderModule({ code: job.wgsl });
      const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: {
          module,
          entryPoint: job.entryPoint ?? "main"
        }
      });

      const buffers = job.buffers.map((buffer) => {
        const size = buffer.size ?? buffer.data?.byteLength ?? 0;
        const usage =
          buffer.usage ??
          (constants.bufferUsage.STORAGE | constants.bufferUsage.COPY_DST | constants.bufferUsage.COPY_SRC);
        const gpuBuffer = device.createBuffer({
          size,
          usage,
          mappedAtCreation: false
        });

        if (buffer.data) {
          device.queue.writeBuffer(gpuBuffer, 0, buffer.data);
        }

        return {
          binding: buffer.binding,
          size,
          gpuBuffer
        };
      });

      const output = buffers.find((buffer) => buffer.binding === job.output);
      if (!output) {
        throw new Error(`Ringan GPU output binding ${job.output} was not provided.`);
      }

      const readBuffer = device.createBuffer({
        size: job.outputSize,
        usage: constants.bufferUsage.COPY_DST | constants.bufferUsage.MAP_READ
      });

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((buffer) => ({
          binding: buffer.binding,
          resource: {
            buffer: buffer.gpuBuffer
          }
        }))
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(job.dispatch[0], job.dispatch[1] ?? 1, job.dispatch[2] ?? 1);
      pass.end();
      encoder.copyBufferToBuffer(output.gpuBuffer, 0, readBuffer, 0, job.outputSize);
      device.queue.submit([encoder.finish()]);

      await readBuffer.mapAsync(constants.mapMode.READ);
      const copy = readBuffer.getMappedRange().slice(0);
      readBuffer.unmap();
      return copy;
    }
  };
}
