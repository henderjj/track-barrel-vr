/**
 * Times a stretch of GPU work with WebGL2's timer queries
 * (EXT_disjoint_timer_query_webgl2), where the browser offers them. Results
 * come back a few frames later; `ms` holds the latest, NaN until there is
 * one or where the browser doesn't offer the extension (some hide it to
 * stop pages fingerprinting the GPU).
 */
export class GpuTimer {
  /** The latest measured time, ms, or NaN. */
  ms = Number.NaN;
  readonly supported: boolean;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private readonly spare: WebGLQuery[] = [];
  private running: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext'];
    this.supported = this.ext !== null;
  }

  begin(): void {
    if (!this.ext || this.running || this.pending.length > 4) {
      return;
    }
    const query = this.spare.pop() ?? this.gl.createQuery();
    if (!query) {
      return;
    }
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.running = query;
  }

  end(): void {
    if (!this.ext || !this.running) {
      return;
    }
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.running);
    this.running = null;
  }

  /** Collect finished queries; call once a frame. */
  poll(): void {
    const gl = this.gl;
    if (!this.ext) {
      return;
    }
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length > 0) {
      const query = this.pending[0];
      if (!(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean)) {
        break;
      }
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      if (!disjoint) {
        this.ms = ns / 1e6;
      }
      this.pending.shift();
      this.spare.push(query);
    }
  }

  dispose(): void {
    for (const query of [...this.pending, ...this.spare]) {
      this.gl.deleteQuery(query);
    }
    this.pending.length = 0;
    this.spare.length = 0;
  }
}
