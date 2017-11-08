import {DatabaseApi, DatabaseOperations, SearchParams, SearchParamsOrder} from './api/database';
import {ChainApi, ChainMethods} from './api/chain';
import {
    BuyContentOperation,
    ContentCancelOperation,
    Key,
    KeyParts,
    OperationName,
    SubmitContentOperation,
    Transaction
} from './transaction';
import {Asset} from './account';

const moment = require('moment');

export interface SubmitObject {
    authorId: string
    seeders: Array<any>
    fileName: string
    fileContent: Buffer
    date: string
    fileSize: number
    price: number
    size: number
    URI: string
    hash: string
    keyParts: KeyParts[]
    synopsis: Synopsis
}

export interface Content {
    id: string
    author: string
    price: Price
    synopsis: Synopsis
    status: Status
    URI: string
    _hash: string
    AVG_rating: number
    size: number
    expiration: string
    created: string
    times_bought: number
}

export interface Synopsis {
    title: string
    description: string
    content_type_id: string
    file_name: string
    language: string
    sampleURL: string
    fileFormat: string
    length: string
    content_licence: string
    thumbnail: string
    userRights: string
}

export class ContentType {
    private _appId: number;
    private _category: number;
    private _subCategory: number;
    private _isInappropriate: boolean;

    constructor(appId: number,
                category: number,
                subCategory: number,
                isInappropriate: boolean) {
        this._appId = appId;
        this._category = category;
        this._subCategory = subCategory;
        this._isInappropriate = isInappropriate;
    }

    public getId(): string {
        return `${this._appId}.${this._category}.${this._subCategory}.${this
            ._isInappropriate}`;
    }
}

export interface Price {
    amount: number
    asset_id: string
}

export class Status {
    static Uploaded = 'Uploaded';
    static Partially_uploaded = 'Partially uploaded';
    static Uploading = 'Uploading';
    static Expired = 'Expired';
}

export interface Seeder {
    id: string
    seeder: string
    free_space: number
    price: Asset
    expiration: string
    pubKey: Key
    ipfs_ID: string
    stats: string
    rating: number
    region_code: string
}

/**
 * ContentApi provide methods to communication
 * with content stored in decent network.
 */
export class ContentApi {
    private _dbApi: DatabaseApi;
    private _chainApi: ChainApi;

    constructor(dbApi: DatabaseApi, chainApi: ChainApi) {
        this._dbApi = dbApi;
        this._chainApi = chainApi;
    }

    public searchContent(searchParams: SearchParams): Promise<Content[]> {
        const dbOperation = new DatabaseOperations.SearchContent(searchParams);
        return new Promise((resolve, reject) => {
            this._dbApi
                .execute(dbOperation)
                .then((content: any) => {
                    content.forEach((c: any) => {
                        c.synopsis = JSON.parse(c.synopsis);
                    });
                    resolve(content);
                })
                .catch((err: any) => {
                    reject(err);
                });
        });
    }

    /**
     * Fetch content object from blockchain for given content id
     *
     * @param {string} id example: '1.2.345'
     * @return {Promise<Content>}
     */
    public getContent(id: string): Promise<Content> {
        return new Promise((resolve, reject) => {
            const chainOps = new ChainMethods();
            chainOps.add(ChainMethods.getObject, id);
            this._chainApi
                .fetch(chainOps)
                .then((response: any[]) => {
                    const [content] = response;
                    const stringidied = JSON.stringify(content);
                    const objectified = JSON.parse(stringidied);
                    objectified.price = objectified.price.map_price[0][1];
                    resolve(objectified as Content);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    /**
     * Cancel submitted content record from blockchain.
     *
     * @param {string} contentId example: '2.13.1234'
     * @param {string} authorId example: '1.2.532'
     * @param {string} privateKey
     * @return {Promise<any>}
     */
    public removeContent(contentId: string,
                         authorId: string,
                         privateKey: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.getContent(contentId)
                .then((content: Content) => {
                    const URI = content.URI;
                    const methods = new ChainMethods();
                    methods.add(ChainMethods.getAccount, authorId);

                    this._chainApi.fetch(methods)
                        .then(result => {
                            const [account] = result;
                            const publicKey = account
                                .get('owner')
                                .get('key_auths')
                                .get(0)
                                .get(0);
                            const cancellation: ContentCancelOperation = {
                                author: authorId,
                                URI: URI
                            };
                            const transaction = new Transaction();
                            transaction.addOperation({name: OperationName.content_cancellation, operation: cancellation});
                            transaction.broadcast(privateKey)
                                .then(() => {
                                    resolve();
                                })
                                .catch(() => {
                                    reject();
                                });
                        });
                });
        });
    }

    /**
     * Restores key to decrypt downloaded content.
     *
     * ElGammalPrivate key is used to identify if user have bought content.
     *
     * @param {String} contentId example: '1.2.453'
     * @param {string} elGammalPrivate
     * @return {Promise<string>} Key to decrypt content
     */
    public restoreContentKeys(contentId: string,
                              elGammalPrivate: string): Promise<string> {
        const dbOperation = new DatabaseOperations.RestoreEncryptionKey(contentId, elGammalPrivate);
        return new Promise((resolve, reject) => {
            this._dbApi
                .execute(dbOperation)
                .then(key => {
                    resolve(key);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    /**
     * Obtains content key with key parts of each seeder to encrypt
     * content to be uploaded.
     *
     * @param {string[]} seeders Array of seeders ids example: ['1.2.12', '1.4.13']
     * @return {Promise<any>}
     */
    public generateContentKeys(seeders: string[]): Promise<any> {
        const dbOperation = new DatabaseOperations.GenerateContentKeys(seeders);
        return new Promise((resolve, reject) => {
            this._dbApi
                .execute(dbOperation)
                .then(keys => {
                    resolve(keys);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    /**
     * Submit content to blockchain
     * Need to supply control checksum 'ripemdHash' and
     * 'key' generated by seeders in getContentKeys
     *
     * @param {SubmitObject} content
     * @param {string} privateKey
     * @param {string} publicKey
     * @return {Promise<any>}
     */
    public addContent(content: SubmitObject,
                      privateKey: string): Promise<any> {
        return new Promise((resolve, reject) => {
            content.size = this.getFileSize(content.size);
            const submitOperation: SubmitContentOperation = {
                size: content.size,
                author: content.authorId,
                co_authors: [],
                URI: content.URI,
                quorum: content.seeders.length,
                price: [
                    {
                        region: 1,
                        price: {
                            amount: content.price,
                            asset_id: ChainApi.asset_id
                        }
                    }
                ],
                hash: content.hash,
                seeders: content.seeders.map(s => s.seeder),
                key_parts: content.keyParts,
                expiration: content.date,
                publishing_fee: {
                    amount: this.calculateFee(content),
                    asset_id: ChainApi.asset_id
                },
                synopsis: JSON.stringify(content.synopsis)
            };
            const transaction = new Transaction();
            transaction.addOperation({name: OperationName.content_submit, operation: submitOperation});
            transaction.broadcast(privateKey)
                .then(() => {
                    resolve();
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    private getFileSize(fileSize: number): number {
        return Math.ceil(fileSize / (1024 * 1024));
    }

    private calculateFee(content: SubmitObject): number {
        const num_days = moment(content.date).diff(moment(), 'days') + 1;
        return Math.ceil(
            this.getFileSize(content.fileSize) *
            content.seeders.reduce(
                (fee, seed) => fee + seed.price.amount * num_days,
                0
            )
        );
    }

    /**
     * Request buy content.
     *
     * @param {string} contentId Id of content to be bought, example: '1.2.123'
     * @param {string} buyerId Account id of user buying content, example: '1.2.123'
     * @param {string} elGammalPub ElGammal public key which will be used to identify users bought content
     * @param {string} privateKey
     * @return {Promise<any>}
     */
    public buyContent(contentId: string,
                      buyerId: string,
                      elGammalPub: string,
                      privateKey: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.getContent(contentId)
                .then((content: Content) => {
                    const buyOperation: BuyContentOperation = {
                        URI: content.URI,
                        consumer: buyerId,
                        price: content.price,
                        region_code_from: 1,
                        pubKey: {s: elGammalPub}
                    };
                    const transaction = new Transaction();
                    transaction.addOperation({name: OperationName.requestToBuy, operation: buyOperation});
                    transaction.broadcast(privateKey)
                        .then(() => {
                            resolve();
                        })
                        .catch((err: any) => {
                            console.log(err);
                            reject();
                        });
                })
                .catch(err => {
                    console.log(err);
                    reject(err);
                });
        });
    }

    /**
     * List available seeders ordered by price.
     *
     * @param {number} resultSize   Number of results per request. Default 100(max)
     * @return {Promise<Seeder[]>}
     */
    public getSeeders(resultSize: number = 100): Promise<Seeder[]> {
        const dbOperation = new DatabaseOperations.ListSeeders(resultSize);
        return new Promise((resolve, reject) => {
            this._dbApi.execute(dbOperation)
                .then(result => {
                    resolve(result as Seeder[]);
                })
                .catch(err => {
                    console.log(err);
                    reject();
                });
        });
    }

    /**
     * Return all purchased content for account id.
     *
     * @param {string} accountId example: '1.2.345'
     * @param {string} order example: '1.2.345'
     * @param {string} startObjectId example: '1.2.345'
     * @param {string} term example: '1.2.345'
     * @param {number} resultSize Number of results default = 100
     * @return {Promise<Content[]>}
     */
    public getPurchasedContent(accountId: string,
                               order: string = SearchParamsOrder.createdDesc,
                               startObjectId: string = '0.0.0',
                               term: string = '',
                               resultSize: number = 100): Promise<Content[]> {
        return new Promise((resolve, reject) => {
            if (!accountId) {
                reject('missing_parameter');
                return;
            }
            const searchParams = new SearchParams();
            searchParams.count = resultSize;
            this.searchContent(searchParams)
                .then(allContent => {
                    const dbOperation = new DatabaseOperations.GetBoughtObjectsByCustomer(
                        accountId,
                        order,
                        startObjectId,
                        term,
                        resultSize);
                    this._dbApi.execute(dbOperation)
                        .then(boughtContent => {
                            const result: Content[] = [];
                            boughtContent.forEach((bought: any) => {
                                allContent.forEach(content => {
                                    if (bought.URI === content.URI) {
                                        bought.synopsis = JSON.parse(bought.synopsis);
                                        result.push(content as Content);
                                    }
                                });
                            });
                            resolve(result);
                        })
                        .catch(err => {
                            reject();
                        });
                });
        });
    }
}
