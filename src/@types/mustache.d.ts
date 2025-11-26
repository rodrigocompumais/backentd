declare module "mustache" {
  const Mustache: {
    render(template: string, view: object, partials?: object): string;
    parse(template: string): any;
    escape(value: string): string;
  };
  export default Mustache;
}

