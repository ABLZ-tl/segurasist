import 'reflect-metadata';
import { PUBLIC_KEY, Public, Roles, ROLES_KEY, Scopes, SCOPES_KEY } from './roles.decorator';

describe('decoradores Roles/Scopes/Public', () => {
  it('@Roles(...) escribe metadata bajo ROLES_KEY con la lista exacta', () => {
    class Foo {}
    Roles('admin_mac', 'operator')(Foo);
    expect(Reflect.getMetadata(ROLES_KEY, Foo)).toEqual(['admin_mac', 'operator']);
  });

  it('@Scopes(...) escribe metadata bajo SCOPES_KEY', () => {
    class Foo {}
    Scopes('read:x', 'write:x')(Foo);
    expect(Reflect.getMetadata(SCOPES_KEY, Foo)).toEqual(['read:x', 'write:x']);
  });

  it('@Public() marca PUBLIC_KEY=true', () => {
    class Foo {}
    Public()(Foo);
    expect(Reflect.getMetadata(PUBLIC_KEY, Foo)).toBe(true);
  });

  it('@Roles() sin argumentos escribe array vacío', () => {
    class Foo {}
    Roles()(Foo);
    expect(Reflect.getMetadata(ROLES_KEY, Foo)).toEqual([]);
  });
});
