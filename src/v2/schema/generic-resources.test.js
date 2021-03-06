/** *****************************************************************************
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2018. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 ****************************************************************************** */
// Copyright (c) 2020 Red Hat, Inc.
// Copyright Contributors to the Open Cluster Management project

import supertest from 'supertest';
import server, { GRAPHQL_PATH } from '../index';

describe('Generic Resources', () => {
  test('Correctly Resolves Get Resource Locally', () => new Promise((done) => {
    supertest(server)
      .post(GRAPHQL_PATH)
      .send({
        query: `
        {
          getResource(selfLink:"/api/v1/namespaces/kube-system/pods/monitoring-prometheus-nodeexporter-n6h9b", namespace:null, kind:null, name:null, cluster:"local-cluster")
        }`,
      })
      .end((err, res) => {
        expect(JSON.parse(res.text)).toMatchSnapshot();
        done();
      });
  }));

  test('Correctly Resolves Update Local Resource', () => new Promise((done) => {
    supertest(server)
      .post(GRAPHQL_PATH)
      .send({
        query: `
        {
          updateResource(selfLink: "/api/v1/namespaces/klusterlet", namespace: "", kind: "namespace", name: "klusterlet", cluster: "local-cluster", body: {kind: "Namespace", apiVersion: "v1", metadata: {name: "klusterlet", selfLink: "/api/v1/namespaces/klusterlet", uid: "34ddc94d-70dc-11e9-865a-00000a15079c", resourceVersion: "2120711", creationTimestamp: "2019-05-07T15:24:29Z", labels: {icp: "system", test: "test"}}, spec: {finalizers: ["kubernetes"]}, status: {phase: "Active"}})
        }
        `,
      })
      .end((err, res) => {
        expect(JSON.parse(res.text)).toMatchSnapshot();
        done();
      });
  }));

  test('Correctly Resolves Update Remote Resource', () => new Promise((done) => {
    Date.now = jest.fn(() => 1234);
    supertest(server)
      .post(GRAPHQL_PATH)
      .send({
        query: `
        {
          updateResource(selfLink: "/api/v1/namespaces/kube-system/secrets/platform-auth-service", namespace: "kube-system", kind: "Secret", name: "platform-auto-service", cluster: "layne-remote", body: {apiVersion: "v1", kind: "Secret", metadata: {creationTimestamp: "2019-04-16T01:40:57Z", name: "platform-auth-service", namespace: "kube-system", resourceVersion: "6278503", selfLink: "/api/v1/namespaces/kube-system/secret/platform-auth-service", uid: "ae97cf94-5fe8-11e9-bfe4-00000a150993"}, })
        }
        `,
      })
      .end((err, res) => {
        expect(JSON.parse(res.text)).toMatchSnapshot();
        done();
      });
  }));

  test('Should Report Error While Create Resources Mutation', () => new Promise((done) => {
    supertest(server)
      .post(GRAPHQL_PATH)
      .send({
        query: `
        mutation {
          createResources(resources:[{
            apiVersion: "mcm.ibm.com/v1alpha1",
            kind: "Application",
            metadata: {
              name: "testapp",
              labels: {
                deployable: "deployable01",
                hcmapp: "testapp",
              },
            },
            spec: {
              selector: {
                matchLabels: {
                  hcmapp: "testapp",
                },
              },
              componentKinds: [
                {
                  group: "mcm.ibm.com/v1alpha1",
                  kind: "PlacementPolicy",
                },
                {
                  group: "mcm.ibm.com/v1alpha1",
                  kind: "Deployable",
                },
              ],
            },
          }])
        }
      `,
      })
      .end((err, res) => {
        expect(JSON.parse(res.text)).toMatchSnapshot();
        done();
      });
  }));

  test('Correctly Resolves Create Resources Mutation', () => new Promise((done) => {
    supertest(server)
      .post(GRAPHQL_PATH)
      .send({
        query: `
        mutation {
          createResources(resources:[{
            apiVersion: "mcm.ibm.com/v1alpha1",
            kind: "Application",
            metadata: {
              name: "testapp",
              namespace: "default",
              labels: {
                deployable: "deployable01",
                hcmapp: "testapp",
              },
            },
            spec: {
              selector: {
                matchLabels: {
                  hcmapp: "testapp",
                },
              },
              componentKinds: [
                {
                  group: "mcm.ibm.com/v1alpha1",
                  kind: "PlacementPolicy",
                },
                {
                  group: "mcm.ibm.com/v1alpha1",
                  kind: "Deployable",
                },
              ],
            },
          }])
        }
      `,
      })
      .end((err, res) => {
        expect(JSON.parse(res.text)).toMatchSnapshot();
        done();
      });
  }));

  test('Correctly Resolves Update Cluster Labels', () => new Promise((done) => {
    supertest(server)
      .post(GRAPHQL_PATH)
      .send({
        query: `
        mutation {
          updateResourceLabels(resourceType:"HCMCompliance",kind:"Compliance",apiVersion:"compliance.mcm.ibm.com/v1alpha1",namespace:"my-remote-cluster-1", name:"compliance-xz", body:{cloud:"IBMs"}, selfLink:"/apis/compliance.mcm.ibm.com/v1alpha1/namespaces/my-remote-cluster-1/compliances/compliance-xz", resourcePath:"/metadata/spec")
        }
      `,
      })
      .end((err, res) => {
        expect(JSON.parse(res.text)).toMatchSnapshot();
        done();
      });
  }));

  test('Correctly Resolves update Compliance Mutation', () => new Promise((done) => {
    supertest(server)
      .post(GRAPHQL_PATH)
      .send({
        query: `
        mutation {
          updateResource(resourceType: "HCMCompliance", namespace: "mcm", name: "test-compliance", selfLink: "/apis/compliance.mcm.ibm.com/v1alpha1/namespaces/mcm/compliances/test-compliance", body:{
            apiVersion: "compliance.mcm.ibm.com/v1alpha1",
            kind: "Compliance",
            metadata: {
              name: "test-compliance",
              namespace: "mcm",
              description: "Instance descriptor for compliance resource",
            },
            spec: {
              clusterSelector: {
                matchNames: [
                  "mycluster",
                ],
              },
              runtimeRules: [
                {
                  apiVersion: "policy.open-cluster-management.io/v1",
                  kind: "Policy",
                  metadata: {
                    name: "test-policy-1",
                    description: "Instance descriptor for policy resource",
                  },
                  spec: {
                    remediationAction: "inform",
                    namespaces: {
                      include: [
                        "default",
                      ],
                      exclude: [
                        "kube*",
                      ],
                    },
                    roleTemplates: [
                      {
                        kind: "RoleTemplate",
                        apiVersion: "roletemplate.mcm.ibm.com/v1alpha1",
                        complianceType: "musthave",
                        metadata: {
                          namespace: "",
                          name: "role-xz-1",
                        },
                        selector: {
                          matchLabels: {
                            cloud: "IBM",
                          },
                        },
                        rules: [
                          {
                            complianceType: "musthave",
                            PolicyRule: {
                              apiGroups: [
                                "extensions",
                                "apps",
                              ],
                              resources: [
                                "deployments",
                              ],
                              verbs: [
                                "get",
                                "list",
                                "watch",
                                "create",
                                "delete",
                                "patch",
                              ],
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          })
        }
      `,
      })
      .end((err, res) => {
        expect(JSON.parse(res.text)).toMatchSnapshot();
        done();
      });
  }));

  test('Correctly Resolves Pod log query', () => new Promise((done) => {
    supertest(server)
      .post(GRAPHQL_PATH)
      .send({
        query: `
        {
          logs(containerName: "search-api", podName:"search-prod-28a0e-search-api-66cf776db5-7bzfh", podNamespace:"open-cluster-management", clusterName:"cluster1")
        }
      `,
      })
      .end((err, res) => {
        expect(JSON.parse(res.text)).toMatchSnapshot();
        done();
      });
  }));
});
