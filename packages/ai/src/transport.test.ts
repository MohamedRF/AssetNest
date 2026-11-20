import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createProviderTransport, validateProviderEndpoint } from './transport.js';

describe('AI provider egress policy', () => {
  it('disallows custom native hosts, embedded credentials, implicit private origins and metadata', async () => {
    await expect(validateProviderEndpoint('openai', null, [])).resolves.toBeNull();
    await expect(validateProviderEndpoint('openai', 'https://8.8.8.8', [])).rejects.toMatchObject({
      code: 'invalid_endpoint',
    });
    await expect(validateProviderEndpoint('ollama', 'http://127.0.0.1:11434', [])).rejects.toMatchObject({
      code: 'invalid_endpoint',
    });
    for (const endpoint of [
      'http://169.254.169.254',
      'http://[fd00:ec2::254]',
      'https://[::ffff:169.254.169.254]',
      'https://user:password@8.8.8.8',
      'https://8.8.8.8?key=example',
    ]) {
      await expect(validateProviderEndpoint('ollama', endpoint, [new URL(endpoint).origin])).rejects.toMatchObject({
        code: 'invalid_endpoint',
      });
    }
    const local = 'http://127.0.0.1:11434';
    await expect(validateProviderEndpoint('ollama', `${local}/models`, [local])).resolves.toHaveProperty(
      'origin', local,
    );
  });

  it('revalidates and pins a local connection and refuses redirects and path escapes', async () => {
    const seen: Array<{ path: string | undefined; auth: string | undefined }> = [];
    const server = createServer((req, res) => {
      seen.push({ path: req.url, auth: req.headers.authorization });
      if (req.url === '/v1/redirect') {
        res.writeHead(302, { Location: '/secret' }).end();
        return;
      }
      res.end('{"data":[]}');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
      const origin = `http://127.0.0.1:${address.port}`;
      const transport = createProviderTransport('openai_compatible', `${origin}/v1`, 'fixture', [origin]);
      const query = (path: string) => transport.request({ path, method: 'GET', signal: AbortSignal.timeout(2_000) });
      await expect(query('/models')).resolves.toEqual({ data: [] });
      await expect(query('/redirect')).rejects.toMatchObject({ code: 'unavailable' });
      await expect(query('/../secret')).rejects.toMatchObject({ code: 'invalid_endpoint' });
      await expect(query('//external.example')).rejects.toMatchObject({ code: 'invalid_endpoint' });
      expect(seen).toEqual([
        { path: '/v1/models', auth: 'Bearer fixture' },
        { path: '/v1/redirect', auth: 'Bearer fixture' },
      ]);
    } finally {
      server.close();
    }
  });
});
