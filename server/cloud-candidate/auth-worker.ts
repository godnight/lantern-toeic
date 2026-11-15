// A deliberately narrow Worker built from the repository's existing services.
// Phone routes remain hard-disabled by phoneFlowAction's null provider.
import { authJson, credentialAction, sessionAction, type AuthEnvironment } from '../../lib/auth-service';
import { huaweiAuthAction, huaweiProvidersAction } from '../../lib/huawei-auth-service';
import { phoneFlowAction } from '../../lib/phone-flow-service';

const routes = new Map([
  ['/health', 'GET'], ['/api/auth/register', 'POST'], ['/api/auth/login', 'POST'],
  ['/api/auth/session', 'GET'], ['/api/auth/logout', 'POST'], ['/api/auth/providers', 'GET'],
  ['/api/auth/huawei/login', 'POST'], ['/api/auth/huawei/bind', 'POST'],
  ['/api/auth/phone/status', 'GET'], ['/api/auth/phone/challenge', 'POST'],
  ['/api/auth/phone/login', 'POST'], ['/api/auth/phone/bind', 'POST'],
]);

export default {
  async fetch(request: Request, env: AuthEnvironment): Promise<Response> {
    const url = new URL(request.url);
    const method = routes.get(url.pathname);
    if (!method || url.search) return authJson({ code: 'not-found' }, 404);
    if (request.method !== method) {
      const result = authJson({ code: 'method-not-allowed' }, 405);
      result.headers.set('Allow', method);
      return result;
    }
    switch (url.pathname) {
      case '/health': return authJson({ status: 'ok' });
      case '/api/auth/register': return credentialAction(request, 'register', env);
      case '/api/auth/login': return credentialAction(request, 'login', env);
      case '/api/auth/session': return sessionAction(request, 'read', env);
      case '/api/auth/logout': return sessionAction(request, 'logout', env);
      case '/api/auth/providers': return huaweiProvidersAction(request, env);
      case '/api/auth/huawei/login': return huaweiAuthAction(request, 'login', env);
      case '/api/auth/huawei/bind': return huaweiAuthAction(request, 'bind', env);
      case '/api/auth/phone/status': return phoneFlowAction(request, 'status', env);
      case '/api/auth/phone/challenge': return phoneFlowAction(request, 'challenge', env);
      case '/api/auth/phone/login': return phoneFlowAction(request, 'login', env);
      case '/api/auth/phone/bind': return phoneFlowAction(request, 'bind', env);
      default: return authJson({ code: 'not-found' }, 404);
    }
  },
};
