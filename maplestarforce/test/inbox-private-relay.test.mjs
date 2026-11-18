import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compileRelayRanges} from '../../services/blacksmith-inbox/private-relay.mjs';
test('Private Relay CIDR matching covers IPv4/IPv6 boundaries, adjacent ranges and mapped IPv4',()=>{
  const list=compileRelayRanges('172.224.226.0/27,US,Test\n172.224.226.32/31,US,Test\n2001:db8::/64,KR,Test\n2001:db8:1::/128,KR,Test\n');
  assert.equal(list.rows,4);assert.equal(list.intervals,3);
  for(const ip of ['172.224.226.0','172.224.226.31','172.224.226.33','::ffff:172.224.226.33','::ffff:ace0:e221','2001:db8::','2001:db8::ffff','2001:db8:1::'])assert.equal(list.isBlocked(ip),true,ip);
  for(const ip of ['172.224.225.255','172.224.226.34','2001:db8:0:1::','2001:db8:1::1','192.0.2.1','invalid',''])assert.equal(list.isBlocked(ip),false,ip);
});
test('invalid or overly broad relay feeds cannot replace the known good ranges',()=>{
  for(const csv of ['garbage','0.0.0.0/0,XX','::/0,XX','2001:db8::/129,XX','1.2.3.4/33,XX','1.2.3.4/,XX'])assert.throws(()=>compileRelayRanges(csv),/Invalid Apple/);
});
